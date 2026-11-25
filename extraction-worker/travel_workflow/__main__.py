"""Small standalone CLI for travel-video evidence preparation."""
import argparse
import json
import sys
from pathlib import Path
from .quick_reference import prepare_reference
from .video_acquisition import acquire_video, AcquisitionError
from .fast_workflow import find_cached, run_batch, detail_frames

def main():
    parser = argparse.ArgumentParser(description=__doc__)
    sub = parser.add_subparsers(dest="command", required=True)
    for name in ("acquire", "prepare"):
        command = sub.add_parser(name)
        command.add_argument("--source-url", required=True)
        command.add_argument("--output", required=True)
        command.add_argument("--provider", default="auto", choices=["tikwm", "auto", "yt-dlp", "instagram-direct"])
        if name == 'prepare':
            command.add_argument('--fast', action='store_true')
            command.add_argument('--refresh', action='store_true')
    examples = str(Path(__file__).resolve().parents[1] / 'examples')
    find = sub.add_parser('find', help='Find cached analyses and produce native search entry points')
    find.add_argument('--theme', required=True)
    find.add_argument('--catalog', action='append')
    find.add_argument('--output')
    batch = sub.add_parser('batch', help='Prepare a short list in parallel and emit one review packet')
    batch.add_argument('--theme', required=True)
    batch.add_argument('--candidates', required=True, help='JSON list of observed URLs or source_url/title/caption objects')
    batch.add_argument('--output', required=True)
    batch.add_argument('--catalog', action='append')
    batch.add_argument('--limit', type=int, default=4)
    batch.add_argument('--workers', type=int, choices=[1, 2], default=2)
    batch.add_argument('--refresh', action='store_true')
    batch.add_argument('--thorough', action='store_true')
    detail = sub.add_parser('details', help='Extract just the frames needed to resolve an uncertain name')
    detail.add_argument('--prepared-dir', required=True)
    detail.add_argument('--times', required=True, type=float, nargs='+')
    args = parser.parse_args()
    try:
        if args.command == 'find':
            result = find_cached(args.theme, args.catalog or [examples])
            if args.output:
                from .fast_workflow import atomic_json
                atomic_json(args.output, result)
        elif args.command == 'batch':
            candidates = json.loads(Path(args.candidates).read_text())
            if isinstance(candidates, dict):
                candidates = candidates.get('candidates', candidates.get('cached_matches'))
            if not isinstance(candidates, list):
                raise ValueError('Candidates must be a JSON list or a find output')
            result = run_batch(args.theme, candidates, args.output, args.catalog or [examples],
                               limit=args.limit, workers=args.workers, refresh=args.refresh,
                               fast=not args.thorough,
                               on_event=lambda e: print(json.dumps(e), flush=True))
        elif args.command == 'details':
            result = detail_frames(args.prepared_dir, args.times)
        elif args.command == 'prepare':
            result = prepare_reference(args.source_url, args.output, provider=args.provider,
                                       fast=args.fast, reuse=not args.refresh)
        else:
            result = acquire_video(args.source_url, args.output, provider=args.provider)
    except (AcquisitionError, ValueError, OSError) as error:
        print(json.dumps({"status": "failed", "error": str(error)}), file=sys.stderr)
        return 1
    print(json.dumps(result, indent=2))
    return 1 if result.get('status') == 'partial_failure' else 0

if __name__ == "__main__":
    raise SystemExit(main())
