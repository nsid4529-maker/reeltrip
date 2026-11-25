"""Boundaries shared by the HTTP service, model pipeline, and tests."""
from __future__ import annotations
import hashlib
import math
import re
from urllib.parse import urlsplit, urlunsplit
from travel_workflow.video_acquisition import AcquisitionError, canonical_source

class ProcessingError(Exception):
    def __init__(self, code: str, message: str, retryable: bool = False, *, correction_issues: list | None = None):
        super().__init__(message)
        self.code, self.message, self.retryable = code, message, retryable
        self.correction_issues = correction_issues or []


def canonical_url(value: object) -> str:
    if not isinstance(value, str) or len(value) > 1000:
        raise ProcessingError('invalid_url', 'Share a public Instagram or TikTok video link.')
    try:
        p = urlsplit(value)
        if p.username or p.password or p.port:
            raise ValueError
        # Normalize aliases only; no network request or arbitrary URL resolution.
        if p.hostname == 'm.tiktok.com':
            p = p._replace(netloc='www.tiktok.com')
        if p.hostname in {'instagram.com', 'www.instagram.com'} and p.path.startswith('/reels/'):
            p = p._replace(path=p.path.replace('/reels/', '/reel/', 1))
        _, url = canonical_source(urlunsplit(p))
        return url
    except (AcquisitionError, ValueError, TypeError):
        raise ProcessingError('invalid_url', 'Share a public Instagram or TikTok video link, not a profile or feed.') from None


def bounded_text(value: object, limit: int, allow_empty: bool = False) -> str:
    if not isinstance(value, str) or len(value) > limit or (not value.strip() and not allow_empty):
        raise ProcessingError('analysis_invalid', 'The video analysis could not be verified. Please try again.', True)
    return value.strip()


def name_in_text(name: str, text: str) -> bool:
    """Match literal names without assuming Chinese/Japanese words have spaces."""
    def normalise(value):
        return re.sub(r'\s+', ' ', value.casefold().replace('&', ' and ')).strip()
    needle = normalise(name)
    # CJK text can touch a name; Latin words still cannot match inside another word.
    word_edge = r'[^\W\u3040-\u30ff\u3400-\u4dbf\u4e00-\u9fff]'
    return bool(needle and re.search(r'(?<!' + word_edge + ')' + re.escape(needle) + r'(?!' + word_edge + ')', normalise(text)))


def evidence_span(item, evidence, duration):
    basis=item.get('evidence_type'); quote=bounded_text(item.get('evidence_quote'),350)
    start,end=item.get('start'),item.get('end'); index=item.get('evidence_index')
    if index is not None and basis in ('speech','screen_text'):
        source=evidence.get('frame_times',[]) if basis=='screen_text' else evidence.get('transcript',{}).get('segments',[])
        if type(index) is not int or not 0<=index<len(source):
            raise ProcessingError('analysis_invalid','A recommendation has no source evidence at its index.',True)
        if basis=='screen_text':start=end=source[index]
        else:start,end=source[index]['start'],source[index]['end']
    if type(start) not in (int,float) or type(end) not in (int,float) or not math.isfinite(start) or not math.isfinite(end) or not 0<=start<=end<=duration:
        raise ProcessingError('analysis_invalid','Invalid source timestamp.',True)
    if basis=='speech':
        supported=[segment for segment in evidence.get('transcript',{}).get('segments',[]) if quote.casefold() in segment.get('text','').casefold()]
        exact=next((segment for segment in supported if start==segment.get('start') and end==segment.get('end')),None)
        if exact is None and index is not None and len(supported)==1:
            start,end=supported[0]['start'],supported[0]['end']
        elif exact is None:
            raise ProcessingError('analysis_invalid','The spoken advice could not be matched to its source audio.',True)
    elif basis=='caption':
        if quote.casefold() not in evidence.get('caption','').casefold():raise ProcessingError('analysis_invalid','The advice could not be matched to its caption.',True)
        start,end=0,duration
    elif basis=='screen_text':
        if start!=end or not any(abs(start-t)<0.01 for t in evidence.get('frame_times',[])):raise ProcessingError('analysis_invalid','A visual recommendation has no sampled frame at its timestamp.',True)
    else:raise ProcessingError('analysis_invalid','Unsupported source evidence.',True)
    return quote,start,end,basis


def result_from_model(raw: object, record: dict, evidence: dict, *, allow_partial: bool = False) -> dict:
    """Never allow model output to choose source identity, URLs or booking providers."""
    if not isinstance(raw, dict) or type(raw.get('is_travel')) is not bool:
        raise ProcessingError('analysis_invalid', 'The video analysis could not be verified. Please try again.', True)
    if not raw['is_travel']:
        return {'not_travel': True, 'reason': bounded_text(raw.get('reason'), 500)}
    duration = record['duration_seconds']
    uploaded = record.get('platform') == 'upload'
    if uploaded:
        from .uploads import upload_reference
        source_url = upload_reference(record.get('upload_id'))
        if source_url != record.get('source_url') or record.get('source_association') != 'private_user_supplied_video':
            raise ProcessingError('analysis_invalid', 'This upload identity could not be verified.')
    else:
        source_url = canonical_url(record['source_url'])
    identity = record['platform'] + ':' + source_url.rstrip('/').rsplit('/', 1)[-1]
    source_id = 'ai-' + hashlib.sha256(identity.encode()).hexdigest()[:20]
    if uploaded:
        source_id = 'ai-upload-' + record['upload_id']
    creator = record.get('provider', {}).get('author_handle')
    if not isinstance(creator, str) or not re.fullmatch(r'[A-Za-z0-9_.-]{1,100}', creator):
        creator = 'Creator not confirmed'
    if uploaded:
        creator = 'Your upload'
    scope = bounded_text(raw.get('scope'), 300)
    title = bounded_text(raw.get('title'), 180)
    unknowns = raw.get('unknowns')
    places = raw.get('places')
    if not isinstance(unknowns, list) or len(unknowns) > 20 or not isinstance(places, list) or len(places) > 32:
        raise ProcessingError('analysis_invalid', 'The video analysis could not be verified. Please try again.', True)
    unknowns = [bounded_text(x, 500) for x in unknowns]
    days: dict[int, list] = {}
    matches = []
    repeated_mentions = {}
    mention_details = {}
    visual_names: dict[str, set[float]] = {}
    unverified = 0
    correction_issues = []
    def note_issue(section, index, item, error):
        # Candidate labels are untrusted data, kept separate from the public error.
        label = item.get('name' if section == 'places' else 'subject')
        issue = {'item': f'{section}[{index}]',
                 'label': label[:180] if isinstance(label, str) else '',
                 'reason': error.message[:300]}
        if section == 'places' and isinstance(label, str) and 0 < len(label) <= 180:
            # Exact supplied caption lines can support a fuller name than a
            # generic activity card. These are source data, never instructions.
            excerpts = [line.strip() for line in caption.splitlines()
                        if 0 < len(line.strip()) <= 350 and name_in_text(label, line)]
            if excerpts:
                issue['caption_excerpts'] = list(dict.fromkeys(excerpts))[:2]
        correction_issues.append(issue)
    transcript = evidence.get('transcript', {}).get('text', '')
    caption = evidence.get('caption', '')
    frame_times = evidence.get('frame_times', [])
    for index, place in enumerate(places):
        if not isinstance(place, dict):
            raise ProcessingError('analysis_invalid', 'The video analysis could not be verified. Please try again.', True)
        try:
            quote,start,end,basis = evidence_span(place,evidence,duration)
        except ProcessingError as error:
            if not allow_partial: note_issue('places', index, place, error)
            unverified += 1
            continue
        category = place.get('category')
        providers = {'Food': ['OpenTable'], 'Stays': ['Booking.com'],
                     'Experiences': ['Viator', 'GetYourGuide'], 'Transport': ['Viator', 'GetYourGuide']}.get(category)
        if providers is None:
            raise ProcessingError('analysis_invalid', 'The video analysis returned an unsupported category. Please try again.', True)
        name = bounded_text(place.get('name'), 180)
        location = bounded_text(place.get('location'), 180)
        details = bounded_text(place.get('details'), 700)
        if not name_in_text(name, quote):
            if not allow_partial:
                note_issue('places', index, place, ProcessingError('analysis_invalid', 'A place name is absent from its quoted evidence. Keep the literal name in its original script within the exact supporting source excerpt. Put English explanations in details; do not translate or invent a source name.', True))
            unverified += 1
            unknowns.append('An uncertain venue or activity name was omitted because its name was not present in the quoted source evidence.')
            continue
        if basis=='screen_text':
            visual_names.setdefault(name.casefold(),set()).add(start)
        day = place.get('day')
        if type(day) is not int or not 0 <= day <= 30:
            raise ProcessingError('analysis_invalid', 'The video analysis returned an invalid day.', True)
        # A weekday is a recurring schedule, never the ordinal day of a holiday.
        if day and not re.search(r'\bday\s*' + str(day) + r'\b', quote, re.IGNORECASE):
            day = 0
        # Day 0 means the creator did not give an itinerary day, not an invented first day.
        detail = {'details': name + ': ' + details, 'time_seconds': [start, end]}
        if detail not in days.setdefault(day, []):
            days[day].append(detail)
        suffix = ' Identified from ' + {'speech': 'speech', 'caption': 'the caption', 'screen_text': 'on-screen text'}[basis] + '. Confirm the venue and details before booking.'
        # A persistent title card is often extracted once per sampled frame.
        # Merge only the exact same evidenced mention; keep every timed detail
        # above, and do not collapse different quotes, locations or itinerary days.
        key = (name, location, category, day, basis, quote)
        existing = repeated_mentions.get(key)
        if existing is not None:
            prior = matches[existing]
            combined = mention_details[existing]
            note = ' '.join(combined + ([] if details in combined else [details])) + suffix
            if len(note) <= 2000:  # The public analysis contract's note limit.
                if details not in combined:
                    combined.append(details)
                prior['note'] = note
                prior['second'] = min(prior['second'], start)
                continue
            # Preserve a separate card rather than truncating source details.
        repeated_mentions[key] = len(matches)
        mention_details[len(matches)] = [details]
        matches.append({'id': f'{source_id}-{index + 1}', 'source': source_id, 'title': name,
                        'place': location, 'category': category, 'kind': 'AI-extracted mention',
                        'quote': quote, 'second': start, 'query': name + ' ' + location,
                        'providers': providers,
                        'note': details + suffix})
    tips=[]
    raw_tips=raw.get('practical_tips',[])
    if not isinstance(raw_tips,list) or len(raw_tips)>24:raise ProcessingError('analysis_invalid','Invalid practical advice.',True)
    for index, tip in enumerate(raw_tips):
        if not isinstance(tip,dict) or tip.get('topic') not in ('Timing','Transport','Tickets','Stay length','Route','Other'):raise ProcessingError('analysis_invalid','Invalid practical advice.',True)
        try:
            quote,start,end,basis=evidence_span(tip,evidence,duration)
            # A generic caption cannot substantiate a multi-stop route assembled
            # from other evidence. This checks known names, not visual OCR truth.
            details=bounded_text(tip.get('details'),700)
            named_places={match['title'] for match in matches
                          if name_in_text(match['title'], details)}
            if len(named_places)>1 and any(not name_in_text(name, quote) for name in named_places):
                raise ProcessingError('analysis_invalid','A multi-place tip names places absent from its quoted source. Use one supporting excerpt or keep the individually supported details.',True)
            if len(named_places)>1 and basis=='screen_text' and any(start not in visual_names.get(name.casefold(),set()) for name in named_places):
                raise ProcessingError('analysis_invalid','A multi-place visual tip combines places whose evidence is on different frames. Keep their separately supported recommendations instead.',True)
        except ProcessingError as error:
            if not allow_partial: note_issue('practical_tips', index, tip, error)
            unverified += 1
            continue
        tips.append({'subject':bounded_text(tip.get('subject'),180),'topic':tip['topic'],'details':details,'quote':quote,'time_seconds':[start,end],'basis':basis})
    if correction_issues:
        raise ProcessingError('analysis_invalid', correction_issues[0]['reason'], True, correction_issues=correction_issues)
    if unverified and not matches and not tips:
        raise ProcessingError('analysis_invalid','No recommendations could be matched to source evidence.',True)
    unknowns=unknowns[:36]
    if unverified:
        warning=f'Partial breakdown: {unverified} detail(s) could not be verified against source evidence after a correction attempt and were excluded. Review the original reel for missing details.'
        unknowns.insert(0,warning)
        scope=scope+' · '+warning
    if not places:
        unknowns.append('No named venues or activities could be identified confidently from this video.')
    unknowns.append('AI-generated from sampled frames and speech; not manually reviewed. Provider listings and availability are not confirmed.')
    if uploaded:
        unknowns.append('User-uploaded video. Original creator attribution and publication link were not supplied or verified.')
    return {'source': {'id': source_id, 'platform': 'Uploaded video' if uploaded else 'TikTok' if record['platform'] == 'tiktok' else 'Instagram',
                       'source_url': source_url, 'creator': creator, 'scope': scope, 'title': title,
                       'analysis_kind': 'ai', 'practical_tips':tips, 'days': [{'day': day, 'items': sorted(items, key=lambda x: x['time_seconds'][0])}
                                                     for day, items in sorted(days.items())],
                       'unknowns': unknowns}, 'matches': matches,
            'provenance': {'original_url': source_url if uploaded else canonical_url(record.get('original_source_url', source_url)), 'source_url': source_url, 'media_sha256': record['sha256'], 'acquired_at': record['acquired_at'],
                           'source_association': record['source_association'],
                           'duration_seconds': duration, 'frame_times': frame_times, 'caption': caption,
                           'transcript': evidence.get('transcript', {}),
                           'analysis_kind': 'ai', 'manually_reviewed': False}}
