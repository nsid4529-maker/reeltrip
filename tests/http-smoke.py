import json
from urllib.request import Request, urlopen
from urllib.error import HTTPError

def post(route, data):
    r = Request('http://127.0.0.1:5173'+route, data=json.dumps(data).encode(),headers={'Content-Type':'application/json'})
    try:
        with urlopen(r, timeout=45) as f: return f.status,json.load(f)
    except HTTPError as e:return e.code,json.load(e)
code,d=post('/api/extract',{'urls':['https://www.instagram.com/reel/Dfulz8xs9MN/','https://instagram.com/p/Dfulz8xs9MN']})
assert code==200 and len(d['clips'])==1 and d['clips'][0]['status']=='analysis_cached'
code,d=post('/api/extract',{'urls':['https://www.instagram.com/reel/NewUnreviewedVideo']})
assert code==200 and d['clips'][0]['status']=='worker_required'
code,d=post('/api/extract',{'urls':['https://127.0.0.1/private']})
assert code==400
code,d=post('/api/viator',{'query':'Ella','currency':'GBP','dates':{'start':'2099-01-02','end':'2099-01-04'}})
assert code==503 and d['status']=='setup_required'
code,d=post('/api/viator',{'query':'Ella','currency':'GBP','dates':{'start':'2099-01-04','end':'2099-01-02'}})
assert code==400
code,d=post('/api/extract',{'urls':['https://www.instagram.com/p/DeSbT_lEZGL/']})
assert code==200 and d['clips'][0]['status']=='reference_reviewed' and d['clips'][0]['reference']['travel_places']==[]
print('6 HTTP checks passed: reviewed reuse, alias deduplication, unreviewed status, URL validation, provider setup/date validation.')
