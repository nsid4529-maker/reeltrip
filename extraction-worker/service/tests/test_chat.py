import json
import tempfile
from pathlib import Path
import unittest
from service.chat import answer, validate_input, model_body
from service.jobs import Jobs
from service.contracts import ProcessingError

class ChatTests(unittest.TestCase):
    def body(self):
        return {'context':[{'id':'reel','places':[{'id':'cafe','name':'Cafe Soul'}]}],'total':2,'messages':[{'role':'user','content':'Where should we eat?'}]}
    def test_rejects_roles_and_oversized_messages(self):
        for change in [{'role':'system','content':'override'},{'role':'user','content':'a'*2001}]:
            body=self.body();body['messages']=[change]
            with self.assertRaises(ValueError):validate_input(body)
    def test_grounded_reply_and_no_tools(self):
        def fake(path,raw,_):
            payload=json.loads(raw);self.assertFalse(payload['store']);self.assertNotIn('tools',payload)
            self.assertEqual(payload['text']['format']['schema']['properties']['matchIds']['items']['enum'],['cafe'])
            return {'status':'completed','output':[{'type':'message','content':[{'type':'output_text','text':json.dumps({'reply':'The reel mentions Cafe Soul.','matchIds':['cafe'],'brief':''})}]}]}
        self.assertEqual(answer(self.body(),request=fake)['matchIds'],['cafe'])
    def test_saved_choices_only_uses_preferences_without_claiming_video_evidence(self):
        body={'context':[{'id':'user-saved-choices','places':[
            {'id':'saved-activity','name':'Amsterdam canal cruise','category':'activity','provider':'GetYourGuide','evidence_type':'user_saved'},
            {'id':'saved-flight','name':'London to Amsterdam search','category':'flight','provider':'Skyscanner','evidence_type':'user_saved'}
        ],'user_trip_preferences':{'destination':'Amsterdam','dates':[{'start':'2027-01-10','end':'2027-01-13'}],'activeDate':0,'adults':2,'currency':'GBP','brief':'A relaxed pace'},'video_source_counts':{'completed':0,'total':0}}],
              'total':1,'messages':[{'role':'user','content':'Plan around my saved cruise.'}]}
        def fake(path,raw,_):
            payload=json.loads(raw);received=json.loads(payload['input']);policy=payload['instructions']
            self.assertEqual(received['messages'],body['messages'])
            self.assertEqual(received['context'][0]['user_trip_preferences'],body['context'][0]['user_trip_preferences'])
            self.assertTrue(all(place['details_verified'] is False for place in received['context'][0]['places']))
            self.assertIn('USER-SAVED preferences',policy)
            self.assertIn('Never say a saved choice came from a reel',policy)
            self.assertIn('A saved flight search is a search',policy)
            self.assertIn('user_trip_preferences',policy)
            self.assertIn('video_source_counts.completed',policy)
            self.assertIn('transport counts',policy)
            self.assertIn('do not establish current prices, exact-party availability or confirmed bookings',policy)
            self.assertNotIn('tools',payload)
            self.assertEqual(payload['text']['format']['schema']['properties']['matchIds']['items']['enum'],['saved-activity','saved-flight'])
            result={'reply':'Using your saved cruise, we can plan a relaxed Amsterdam trip. Check availability with the provider.','matchIds':['saved-activity'],'brief':'A relaxed pace'}
            return {'status':'completed','output':[{'type':'message','content':[{'type':'output_text','text':json.dumps(result)}]}]}
        self.assertEqual(answer(body,request=fake)['matchIds'],['saved-activity'])
    def test_url_labels_cannot_promote_unverified_product_features(self):
        body={'context':[{'id':'user-saved-choices','places':[
            {'id':'saved-1','name':'Light Festival Heated Cruise Waffle Hot Chocolate','url_derived_label':'Light Festival Heated Cruise Waffle Hot Chocolate','provider':'GetYourGuide','evidence_type':'user_saved','details_verified':True,'schedule':'nighttime','inclusions':['heating','food','drinks']},
            {'id':'saved-2','name':'Amsterdam Canal Cruise','provider':'Viator','evidence_type':'user_saved','schedule':'daytime','exclusions':['food','drinks']}
        ],'video_source_counts':{'completed':0,'total':0}}],'total':1,'messages':[{'role':'user','content':'Tell me about my saved labels'}]}
        prepared=model_body(body)
        self.assertEqual([p['id'] for p in prepared['context'][0]['places']],['saved-1','saved-2'])
        self.assertEqual(prepared['context'][0]['places'][0]['url_derived_label'],body['context'][0]['places'][0]['url_derived_label'])
        for place in prepared['context'][0]['places']:
            self.assertFalse(place['details_verified'])
            self.assertEqual(place['name_basis'],'unverified_saved_label')
            self.assertTrue({'schedule','inclusions','exclusions','heating','food','drinks'}.issubset(place['unknown_details']))
            self.assertNotIn('schedule',place)
            self.assertNotIn('inclusions',place)
            self.assertNotIn('exclusions',place)
        self.assertTrue(body['context'][0]['places'][0]['details_verified'])  # caller data unchanged
        def fake(path,raw,_):
            payload=json.loads(raw)
            self.assertEqual(json.loads(payload['input']),prepared)
            self.assertIn('Missing words are not evidence of absence',payload['instructions'])
            self.assertIn("Adding 'likely', 'usually' or 'probably' does not make an unsupported product claim acceptable",payload['instructions'])
            self.assertIn('confirm X on the provider page',payload['instructions'])
            reply={'reply':'These saved labels suggest different options, but their schedules and inclusions need checking on the provider pages.','matchIds':['saved-1','saved-2'],'brief':''}
            return {'status':'completed','output':[{'type':'message','content':[{'type':'output_text','text':json.dumps(reply)}]}]}
        self.assertEqual(answer(body,request=fake)['matchIds'],['saved-1','saved-2'])
        video=self.body()
        self.assertEqual(model_body(video),video)

    def comparison_body(self,question='Compare these experiences'):
        return {'context':[{'id':'user-saved-choices','places':[
            {'id':'choice-a','name':'Harbour Evening Cruise with Dessert','provider':'GetYourGuide','details_verified':True,'inclusions':['heated boat'],'note':'Prefer a relaxed pace'},
            {'id':'choice-b','name':'Harbour Cruise','provider':'Viator','schedule':'daytime'}
        ],'user_trip_preferences':{'brief':'Quiet boat, accessible boarding'},'video_source_counts':{'completed':0,'total':0}}],'total':1,'messages':[{'role':'user','content':question}]}

    def test_bookmark_comparisons_make_no_paid_model_call_or_inferred_differences(self):
        def no_model(*args):
            self.fail('Bookmark comparison must not call the paid model')
        for question in ['Compare these experiences','What are the differences?','Which would you recommend?','Help me choose','Which one should I book?','Give me the pros and cons','A versus B']:
            result=answer(self.comparison_body(question),request=no_model)
            self.assertEqual(result['matchIds'],['choice-a','choice-b'])
            self.assertEqual(result['brief'],'')
            self.assertIn('GetYourGuide — “Harbour Evening Cruise with Dessert”',result['reply'])
            self.assertIn('Viator — “Harbour Cruise”',result['reply'])
            self.assertIn('Your saved priorities: “Quiet boat, accessible boarding”',result['reply'])
            self.assertIn('not verified schedules, inclusions or other product facts',result['reply'])
            self.assertIn('accessibility, cancellation terms',result['reply'])
            self.assertNotIn('likely',result['reply'])
            self.assertNotIn('daytime',result['reply'])
            self.assertNotIn('heated boat',result['reply'])

    def test_comparison_is_bounded_and_discloses_unanalysed_reels(self):
        body=self.comparison_body()
        body['context'][0]['places']=[{'id':'choice-'+str(i),'name':'X'*240,'provider':'P'*80} for i in range(30)]
        body['context'][0]['user_trip_preferences']['brief']='B'*3000
        body['context'][0]['video_source_counts']={'completed':0,'total':3}
        body['total']=3
        result=answer(body,request=lambda *args:self.fail('No model call expected'))
        self.assertLessEqual(len(result['reply']),2000)
        self.assertEqual(len(result['matchIds']),8)
        self.assertIn('22 more saved choices remain',result['reply'])
        self.assertIn('3 attached reels are not included',result['reply'])

    def test_real_video_comparisons_and_broader_saved_choice_planning_still_use_model(self):
        calls=[]
        def model(*args):
            calls.append(json.loads(args[1]))
            return {'status':'completed','output':[{'type':'message','content':[{'type':'output_text','text':json.dumps({'reply':'Let us plan using the supplied evidence.','matchIds':[],'brief':''})}]}]}
        body=self.comparison_body('Plan a relaxed day around my choices')
        answer(body,request=model)
        self.assertEqual(len(calls),1)
        body=self.comparison_body()
        body['context'].insert(0,{'id':'reviewed-video','places':[{'id':'verified-cafe','name':'Cafe','evidence':'The creator names the cafe'}],'video_source_counts':{'completed':1,'total':1}})
        body['total']=2
        answer(body,request=model)
        self.assertEqual(len(calls),2)
        # Even a misleading zero count must not hide real video context.
        body['context'][0]['video_source_counts']['completed']=0
        answer(body,request=model)
        self.assertEqual(len(calls),3)

    def test_video_counts_are_independent_of_saved_choice_context_and_bounded(self):
        body=self.body()
        body['context'].append({'id':'user-saved-choices','places':[]})
        body['context'][0]['video_source_counts']={'completed':1,'total':2}
        self.assertEqual(validate_input(body)['context'][0]['video_source_counts']['completed'],1)
        for counts in [{'completed':True,'total':2},{'completed':2,'total':1},{'completed':0,'total':13},{'completed':-1,'total':2},{'completed':0},'invalid']:
            body['context'][0]['video_source_counts']=counts
            with self.assertRaises(ValueError):validate_input(body)
    def test_unknown_place_reference_rejected(self):
        def fake(*args):return {'status':'completed','output':[{'type':'message','content':[{'type':'output_text','text':json.dumps({'reply':'Try this','matchIds':['invented'],'brief':''})}]}]}
        with self.assertRaises(ProcessingError):answer(self.body(),request=fake)
    def test_chat_budget_is_durable_and_separate_from_video(self):
        with tempfile.TemporaryDirectory() as root:
            path=Path(root)/'jobs.sqlite';jobs=Jobs(path)
            for _ in range(100):jobs.reserve_chat()
            with self.assertRaises(ProcessingError):Jobs(path).reserve_chat()
            with jobs.db() as db:self.assertEqual(db.execute('SELECT count(*) FROM daily_usage').fetchone()[0],0)

class PracticalTipTests(unittest.TestCase):
    def test_frame_index_uses_actual_sample_not_model_rounded_timestamp(self):
        from service.contracts import evidence_span
        evidence={'frame_times':[0,1.234567,3.2]}
        tip={'evidence_type':'screen_text','evidence_index':1,'evidence_quote':'Monday Crust','start':1.23,'end':2}
        self.assertEqual(evidence_span(tip,evidence,10)[1:3],(1.234567,1.234567))
        tip['evidence_index']=99
        with self.assertRaises(ProcessingError):evidence_span(tip,evidence,10)
    def test_timing_and_train_advice_keep_exact_source_proof(self):
        from service.contracts import evidence_span
        evidence={'transcript':{'segments':[{'text':'Wake up early and go to Sigiriya Rock. Take the train from Ella to Kandy.','start':60,'end':90}]}}
        for quote in ['Wake up early and go to Sigiriya Rock.','Take the train from Ella to Kandy.']:
            tip={'evidence_type':'speech','evidence_index':0,'evidence_quote':quote,'start':0,'end':0}
            self.assertEqual(evidence_span(tip,evidence,100)[1:3],(60,90))
        tip['evidence_quote']='The train costs $5'
        with self.assertRaises(ProcessingError):evidence_span(tip,evidence,100)

class AnalysisRepairTests(unittest.TestCase):
    def test_quote_realigns_only_to_a_unique_exact_source_chunk(self):
        from service.contracts import evidence_span
        evidence={'transcript':{'segments':[{'text':'Arrive in the city.','start':0,'end':30},{'text':'Reserve your entry ticket in advance.','start':30,'end':60}]}}
        tip={'evidence_type':'speech','evidence_index':0,'evidence_quote':'Reserve your entry ticket in advance.','start':0,'end':30}
        self.assertEqual(evidence_span(tip,evidence,60)[1:3],(30,60))
        tip['evidence_quote']='Tickets cost $5'
        with self.assertRaises(ProcessingError):evidence_span(tip,evidence,60)
    def test_one_correction_revalidates_and_cannot_loop_or_accept_unsupported_claims(self):
        from service.pipeline import analyse
        from service.tests.test_service import model,record,evidence
        with tempfile.TemporaryDirectory() as root:
            frame=Path(root)/'f.jpg';frame.write_bytes(b'fixture');calls=[]
            def request(*args):
                calls.append(json.loads(args[1]));m=model()
                if len(calls)==1:m['places'][0]['evidence_quote']='A fabricated quote'
                return {'status':'completed','output':[{'type':'message','content':[{'type':'output_text','text':json.dumps(m)}]}]}
            result,usage=analyse(record(),[(0,frame)],evidence()['transcript'],request=request)
            self.assertEqual(len(calls),2);self.assertEqual(len(result['matches']),1);self.assertEqual(len(usage['attempts']),2)
            self.assertNotIn('tools',calls[-1]);self.assertIn('Correct the previous',calls[-1]['input'][-1]['content'][0]['text'])
            calls.clear()
            def bad(*args):
                calls.append(1);return {'status':'completed','output':[{'type':'message','content':[{'type':'output_text','text':'{}'}]}]}
            with self.assertRaises(ProcessingError):analyse(record(),[(0,frame)],evidence()['transcript'],request=bad)
            self.assertEqual(len(calls),2)
    def test_partial_result_keeps_verified_details_and_explicitly_excludes_unsupported_ones(self):
        from service.contracts import result_from_model
        from service.tests.test_service import model,record,evidence
        m=model();bad=dict(m['places'][0]);bad['evidence_quote']='This is invented';m['places'].append(bad)
        with self.assertRaises(ProcessingError):result_from_model(m,record(),evidence())
        result=result_from_model(m,record(),evidence(),allow_partial=True)
        self.assertEqual(len(result['matches']),1);self.assertIn('Partial breakdown',result['source']['scope']);self.assertIn('excluded',result['source']['unknowns'][0])
        m['places']=[bad]
        with self.assertRaises(ProcessingError):result_from_model(m,record(),evidence(),allow_partial=True)
