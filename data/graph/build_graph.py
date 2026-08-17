import json,re,unicodedata,os
from collections import Counter,defaultdict
nfc=lambda s:unicodedata.normalize('NFC',s or '')
docs=[json.loads(l) for l in open('/tmp/build/all_chunks.jsonl') if l.strip()]
for d in docs:
    d['title']=nfc(d['title']); d['cat']=nfc(d.get('cat',''))
    for a in d['arts']: a['name']=nfc(a['name'])
titles=[d['title'] for d in docs]
hier=json.load(open('/tmp/reg_hier.json'))
nospace=lambda s:re.sub(r'\s','',s)
hidx={nospace(nfc(h['규정명'])):nfc(h['규정명']) for h in hier}
H={nfc(h['규정명']):h for h in hier}

# 1) 검증결과 병합
ver=json.load(open('/tmp/build/ver_target.json'))
verdict={}
miss_files=[]
for k in range(22):
    p=f'/tmp/build/vd_{k}.json'
    if not os.path.exists(p): miss_files.append(k); continue
    try:
        for r in json.load(open(p)): verdict[r['id']]=r
    except Exception as e: miss_files.append((k,str(e)))
print('검증파일 누락/오류:',miss_files or '없음')
print('검증 대상',len(ver),'/ 판정수',len(verdict),'/ 미판정',len([e for e in ver if e.get('vid') not in verdict]))

# 2) 노드 정규화(목록/본문 중복 별표·별지 → 본문 canonical)
def knd(name):
    n=nfc(name)
    if re.match(r'제\d+조',n): return 'jo'
    if n.startswith('별표') and '별지' in n: return 'bypj'
    if n.startswith('별표'): return 'byp'
    if n.startswith('별지'): return 'byj'
    if '붙임' in n: return 'byp'
    return 'etc'
def keyof(name):
    n=nfc(name); k=knd(name)
    if k=='jo':
        m=re.match(r'(제\d+조(?:의\d+)?)',n); return ('jo',m.group(1) if m else n)
    if k=='bypj':
        m=re.match(r'별표 제(\d+)호 별지 제(\d+)호',n); return ('bypj',m.group(1),m.group(2)) if m else ('bypj',n)
    if k=='byp':
        m=re.match(r'별표 제(\d+)호',n); return ('byp',m.group(1)) if m else ('byp',n)
    if k=='byj':
        m=re.match(r'별지 제(\d+)호',n); return ('byj',m.group(1)) if m else ('byj',n)
    return ('etc',n)
canon={}  # (di,ci)->ci_canonical
for di,d in enumerate(docs):
    groups=defaultdict(list)
    for a in d['arts']:
        if not nfc(a.get('text','') if 'text' in a else '').strip() and a.get('text') is not None:
            pass
        groups[keyof(a['name'])].append(a)
    for key,arr in groups.items():
        body=max(arr,key=lambda a:len(a.get('text','')))
        for a in arr: canon[(di,a['i'])]=body['i']

# 3) 참조 엣지(검증 통과)
ref=[]
for e in ver:
    v=verdict.get(e.get('vid'))
    if not v or not v.get('is_real'): continue
    di=e['d']
    if e['type'] in ('내부조문','별표','별지'):
        sc=canon.get((di,e['src']),e['src']); tc=canon.get((di,e['tgt_i']),e['tgt_i'])
        if sc==tc: continue
        ref.append({'sd':di,'sc':sc,'kind':'참조','rt':v['rel_type'],'tt':'chunk','td':di,'tc':tc,'reason':v.get('reason','')})
    elif e['type']=='외부규정':
        sc=canon.get((di,e['src']),e['src'])
        ref.append({'sd':di,'sc':sc,'kind':'참조','rt':v['rel_type'],'tt':'doc','tgt':nfc(str(e['tgt'])),'reason':v.get('reason','')})
# 외부법령(검증 생략, 외부 포인터)
cand=json.load(open('/tmp/build/cand_all.json'))
law_edges=0
law_seen=set()
for e in cand:
    if e['type']!='외부법령': continue
    di=e['d']; sc=canon.get((di,e['src']),e['src'])
    key=(di,sc)
    law_edges+=1
print()
print('=== 참조 엣지(검증통과) ===',len(ref))
print('관계유형:',dict(Counter(r['rt'] for r in ref)))
print('대상유형:',dict(Counter(r['tt'] for r in ref)))
docdoc=[r for r in ref if r['tt']=='doc']
print('문서간 참조(chunk->doc):',len(docdoc))
print('문서간 연결 top:',Counter(r['tgt'] for r in docdoc).most_common(10))
print('외부법령 엣지:',law_edges)

# 4) 위계 엣지
hedges=[]
for h in hier:
    c=nfc(h['규정명']); p=nfc(h['직상위규정']).strip()
    if not p: continue
    pr= '외부법령' if p=='외부법령' else hidx.get(nospace(p),p)
    hedges.append({'src':c,'tgt':pr,'kind':'위계'})

# 5) 노드 집계 + 저장
graph={
 'docs':[{'title':d['title'],'cat':d['cat'],'level':H.get(d['title'],{}).get('레벨',''),'nchunks':len(d['arts'])} for d in docs],
 'hier':hedges,
 'ref':ref,
 'law_edge_count':law_edges,
}
json.dump(graph,open('/tmp/build/graph_full.json','w'),ensure_ascii=False)
print()
print('graph_full.json 저장 / 문서',len(docs),'위계엣지',len(hedges),'참조엣지',len(ref))
# 참조 보유 문서 수
srcdocs={r['sd'] for r in ref}
print('참조엣지 보유 문서수:',len(srcdocs))
