import hashlib
import io
import json
import os
import tempfile
import threading
import unittest
import urllib.error
import urllib.request
from pathlib import Path
from unittest.mock import Mock, patch
from service.contracts import ProcessingError, result_from_model
from service.jobs import Jobs
from service.pipeline import process_upload
from service.uploads import RETENTION, Uploads, upload_reference, validate_upload
from service.server import Server

OWNER='a'*64
OTHER='b'*64
PROBE={'duration_seconds':3.0,'audio_present':True,'container_format':'mov,mp4,m4a,3gp,3g2,mj2','streams':[{'codec_type':'video','width':640,'height':360},{'codec_type':'audio'}],'validation':{'full_video_decode_passed':True,'full_audio_decode_passed':True}}

class UploadTests(unittest.TestCase):
    def setUp(self):
        self.temp=tempfile.TemporaryDirectory(); self.now=[1800000000.0]
        self.jobs=Jobs(Path(self.temp.name)/'jobs.sqlite',clock=lambda:self.now[0]); self.uploads=self.jobs.uploads
    def tearDown(self): self.temp.cleanup()
    def receive(self,owner=OWNER,body=b'video-fixture'):
        return self.uploads.receive(io.BytesIO(body),len(body),'video/mp4','my-video.mp4',owner,validator=lambda *_:PROBE)
    def test_save_only_keeps_private_opaque_identity_and_uses_no_analysis_quota(self):
        result=self.receive(); row=self.uploads.get(result['id'],OWNER,True)
        self.assertEqual(self.uploads.file(row['id'],row['mime']).read_bytes(),b'video-fixture')
        self.assertEqual(result['durationSeconds'],3); self.assertNotIn(OWNER,json.dumps(result)); self.assertNotIn('file',result)
        with self.jobs.db() as db:
            self.assertEqual(db.execute('SELECT count(*) FROM daily_usage').fetchone()[0],0)
            self.assertEqual(db.execute('SELECT count(*) FROM jobs').fetchone()[0],0)
        for owner in [OTHER,None,'', 'a'*63]:
            with self.assertRaises(ProcessingError): self.uploads.get(result['id'],owner,True)
        for invalid in ['../jobs.sqlite','https://example.com/video.mp4','id?x=1']:
            with self.assertRaises(ProcessingError): self.uploads.get(invalid,OWNER)
    def test_analysis_cache_and_job_reads_are_owner_scoped_even_after_media_expiry(self):
        item=self.receive(); first=self.jobs.submit_upload(item['id'],OWNER)
        self.assertEqual(first['uploadId'],item['id']); self.assertEqual(self.jobs.submit_upload(item['id'],OWNER)['id'],first['id'])
        self.jobs.finish(first['id'],{'result':{'not_travel':True,'reason':'fixture'}})
        self.assertEqual(self.jobs.upload_result(item['id'],OWNER)['status'],'complete')
        for call in [lambda:self.jobs.get(first['id']),lambda:self.jobs.get(first['id'],OTHER),lambda:self.jobs.upload_result(item['id'],OTHER),lambda:self.jobs.submit_upload(item['id'],OTHER),lambda:self.jobs.submit(upload_reference(item['id']))]:
            with self.assertRaises(ProcessingError):call()
        self.now[0]+=RETENTION-100; self.jobs.finish(first['id'],{'result':{'not_travel':True,'reason':'fixture'}})
        self.now[0]+=101; self.uploads.cleanup(force=True)
        self.assertFalse(self.uploads.file(item['id'],'video/mp4').exists())
        with self.assertRaises(ProcessingError) as caught:self.uploads.get(item['id'],OWNER,True)
        self.assertEqual(caught.exception.code,'upload_expired')
        self.assertEqual(self.jobs.submit_upload(item['id'],OWNER)['status'],'complete')
        self.assertEqual(self.jobs.get(first['id'],OWNER)['status'],'complete')
        self.now[0]+=RETENTION
        with self.assertRaises(ProcessingError):self.jobs.upload_result(item['id'],OWNER)
    def test_expired_unanalysed_upload_cannot_enqueue_or_spend_model_quota(self):
        item=self.receive(); self.now[0]+=RETENTION+1
        with self.assertRaises(ProcessingError):self.jobs.submit_upload(item['id'],OWNER)
        with self.jobs.db() as db:self.assertEqual(db.execute('SELECT count(*) FROM daily_usage').fetchone()[0],0)
    def test_incomplete_or_rejected_files_leave_no_raw_files_or_staging_rows(self):
        for body,size,validator in [(b'abc',5,Mock()),(b'abc',3,Mock(side_effect=ProcessingError('media_invalid','Bad file')))]:
            with self.assertRaises(ProcessingError):self.uploads.receive(io.BytesIO(body),size,'video/mp4','x.mp4',OWNER,validator=validator)
            self.assertEqual(list(self.uploads.directory.iterdir()),[])
            with self.jobs.db() as db:self.assertEqual(db.execute('SELECT count(*) FROM uploads').fetchone()[0],0)
        reader=Mock()
        for size,mime,name in [(0,'video/mp4','x.mp4'),(50000001,'video/mp4','x.mp4'),(1,'text/html','x.mp4'),(1,'video/webm','x.mp4')]:
            with self.assertRaises(ProcessingError):self.uploads.receive(reader,size,mime,name,OWNER)
        reader.read.assert_not_called()
    def test_global_and_per_owner_bytes_are_reserved_before_reading(self):
        with patch('service.uploads.MAX_STORED_BYTES',20),patch('service.uploads.OWNER_BYTES',12):
            self.receive(body=b'1234567890')
            reader=Mock()
            with self.assertRaises(ProcessingError):self.uploads.receive(reader,3,'video/mp4','x.mp4',OWNER)
            self.receive(OTHER,body=b'1234567890')
            with self.assertRaises(ProcessingError):self.uploads.receive(reader,1,'video/mp4','x.mp4','c'*64)
            reader.read.assert_not_called()
    def test_restart_cleans_incomplete_uploads_but_keeps_saved_files(self):
        saved=self.receive(); identity='11111111-1111-4111-8111-111111111111'
        with self.jobs.db() as db:db.execute("INSERT INTO uploads VALUES (?,?,'uploading',5,'video/mp4','x.mp4',?,?,NULL)",(identity,OWNER,self.now[0],self.now[0]+RETENTION))
        incomplete=self.uploads.file(identity,'video/mp4'); incomplete.write_bytes(b'part')
        restarted=Jobs(self.jobs.path,clock=lambda:self.now[0])
        self.assertFalse(incomplete.exists());self.assertEqual(restarted.uploads.get(saved['id'],OWNER,True)['state'],'ready')
    def test_actual_container_dimensions_and_duration_are_checked_before_decode(self):
        path=Path(self.temp.name)/'clip.mp4';path.write_bytes(b'\x00\x00\x00\x18ftypisom')
        for changed in [{'duration_seconds':181},{'container_format':'avi'},{'streams':[{'codec_type':'video','width':9000,'height':9000}]}]:
            with patch('service.uploads.probe_video',return_value={**PROBE,**changed}),patch('service.uploads.decode_video') as decode:
                with self.assertRaises(ProcessingError):validate_upload(path,'video/mp4')
                decode.assert_not_called()
        with patch('service.uploads.probe_video',return_value=PROBE),patch('service.uploads.decode_video',return_value=PROBE['validation']) as decode:
            validated=validate_upload(path,'video/mp4');self.assertTrue(validated['audio_present']);decode.assert_called_once_with(path,True)
        for unsafe in [b'#EXTM3U\nfile:///etc/passwd',b'<script>not video</script>']:
            path.write_bytes(unsafe)
            with patch('service.uploads.probe_video') as probe:
                with self.assertRaises(ProcessingError):validate_upload(path,'video/mp4')
                probe.assert_not_called()
    def test_uploaded_pipeline_uses_frames_and_audio_without_any_url_resolver(self):
        item=self.receive(); record=self.uploads.record_for_job(item['id'])
        with tempfile.TemporaryDirectory() as folder:
            root=Path(folder);video=root/'video.mp4';video.write_bytes(b'video-fixture');record['file']=str(video)
            with patch('service.uploads.validate_upload',return_value=PROBE),patch('service.pipeline.extract_frames',return_value=[(0,root/'frame.jpg')]) as frames,patch('service.pipeline.transcribe',return_value={'segments':[],'text':''}) as audio,patch('service.pipeline.analyse',return_value=({'not_travel':True},{})) as analyse,patch('service.pipeline.acquire_media') as acquire:
                process_upload(record,root)
                frames.assert_called_once();audio.assert_called_once_with(video,root,3.0,True);analyse.assert_called_once();acquire.assert_not_called()
                record['sha256']='0'*64
                with self.assertRaises(ProcessingError):process_upload(record,root)
                self.assertEqual(analyse.call_count,1)
    def test_model_cannot_replace_uploaded_source_identity_or_attribution(self):
        from service.tests.test_service import model,evidence,record
        uploaded={**record(),'platform':'upload','upload_id':'11111111-1111-4111-8111-111111111111','source_association':'private_user_supplied_video'}
        uploaded['source_url']=upload_reference(uploaded['upload_id'])
        raw=model();raw['source_url']='https://evil.test';raw['creator']='Invented'
        result=result_from_model(raw,uploaded,evidence())
        self.assertEqual(result['source']['source_url'],uploaded['source_url']);self.assertEqual(result['source']['creator'],'Your upload')
        self.assertEqual(result['source']['platform'],'Uploaded video');self.assertEqual(result['source']['id'],'ai-upload-'+uploaded['upload_id'])
        self.assertEqual(result['provenance']['original_url'],uploaded['source_url'])
        uploaded['source_url']='/api/upload?id=22222222-2222-4222-8222-222222222222'
        with self.assertRaises(ProcessingError):result_from_model(raw,uploaded,evidence())

class UploadHttpTests(unittest.TestCase):
    def test_private_upload_media_ranges_analysis_and_cache_ownership(self):
        token='test-upload-processor-token-more-than-32-characters'
        with tempfile.TemporaryDirectory() as directory,patch.dict(os.environ,{'REELTRIP_PROCESSOR_TOKEN':token}),patch('service.uploads.probe_video',return_value=PROBE),patch('service.uploads.decode_video',return_value=PROBE['validation']):
            jobs=Jobs(Path(directory)/'jobs.sqlite');server=Server(('127.0.0.1',0),jobs,ready=lambda:True)
            thread=threading.Thread(target=server.serve_forever,daemon=True);thread.start()
            base='http://127.0.0.1:'+str(server.server_port)
            def call(path,body=None,owner=OWNER,extra=None):
                headers={'Authorization':'Bearer '+token,'X-Upload-Owner':owner,**(extra or {})}
                request=urllib.request.Request(base+path,data=body,headers=headers)
                try:
                    with urllib.request.urlopen(request,timeout=5) as response:return response.status,response.read(),response.headers
                except urllib.error.HTTPError as error:return error.code,error.read(),error.headers
            try:
                payload=b'\x00\x00\x00\x18ftypisom-fixture'
                status,raw,_=call('/v1/uploads',payload,extra={'Content-Type':'video/mp4','X-Reel-Filename':'private.mp4'})
                self.assertEqual(status,201);item=json.loads(raw)
                media='/v1/uploads/'+item['id'];status,body,headers=call(media)
                self.assertEqual(status,200);self.assertEqual(body,payload);self.assertEqual(headers['Cache-Control'],'private, no-store')
                status,body,headers=call(media,extra={'Range':'bytes=1-3'})
                self.assertEqual(status,206);self.assertEqual(body,payload[1:4]);self.assertEqual(headers['Content-Range'],f'bytes 1-3/{len(payload)}')
                self.assertEqual(call(media,owner=OTHER)[0],404)
                self.assertEqual(call(media,extra={'Range':'bytes=50-100'})[0],416)
                status,raw,_=call(media+'/jobs',b'{}',extra={'Content-Type':'application/json'})
                self.assertEqual(status,202);job=json.loads(raw)
                self.assertEqual(call('/v1/upload-jobs/'+job['id'],owner=OTHER)[0],404)
                self.assertEqual(call('/v1/jobs/'+job['id'])[0],404)
                jobs.finish(job['id'],{'result':{'not_travel':True,'reason':'synthetic fixture'}})
                self.assertEqual(call(media+'/analysis')[0],200);self.assertEqual(call(media+'/analysis',owner=OTHER)[0],404)
                self.assertEqual(call('/v1/upload-jobs/'+job['id'])[0],200)
            finally:
                server.shutdown();server.server_close();thread.join(timeout=2)

if __name__=='__main__':unittest.main()
