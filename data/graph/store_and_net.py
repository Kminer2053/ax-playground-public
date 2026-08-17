import json,re,unicodedata
from collections import Counter,defaultdict
nfc=lambda s:unicodedata.normalize('NFC',s or '')
docs=[json.loads(l) for l in open('/tmp/build/all_chunks.jsonl') if l.strip()]
for d in docs:
    d['title']=nfc(d['title'])
    for a in d['arts']: a['name']=nfc(a['name'])
title=[d['title'] for d in docs]
name_of=[{a['i']:a['name'] for a in d['arts']} for d in docs]
G=json.load(open('/tmp/build/graph_full.json'))

# ── 1) 엣지 도큐먼트(런타임용) JSONL ──
out=[]
for r in G['ref']:
    sd=title[r['sd']]; sn=name_of[r['sd']].get(r['sc'],'')
    if r['tt']=='chunk':
        out.append({'kind':'ref','sdoc':sd,'sci':r['sc'],'sname':sn,'rt':r['rt'],'tt':'chunk','tdoc':title[r['td']],'tci':r['tc'],'tname':name_of[r['td']].get(r['tc'],''),'reason':r.get('reason','')})
    else:
        out.append({'kind':'ref','sdoc':sd,'sci':r['sc'],'sname':sn,'rt':r['rt'],'tt':'doc','tdoc':r['tgt'],'reason':r.get('reason','')})
for h in G['hier']:
    out.append({'kind':'hier','sdoc':h['src'],'tdoc':h['tgt']})
# 외부법령 엣지
cand=json.load(open('/tmp/build/cand_all.json'))
# canon 재계산 불요 — 외부법령은 src만, 그대로
law_seen=set()
for e in cand:
    if e['type']!='외부법령': continue
    sd=title[e['d']]; key=(sd,e['src'],e['tgt'])
    if key in law_seen: continue
    law_seen.add(key)
    out.append({'kind':'law','sdoc':sd,'sci':e['src'],'sname':name_of[e['d']].get(e['src'],''),'tt':'law','tgt':nfc(str(e['tgt']))})
with open('/tmp/build/edges.jsonl','w') as f:
    for o in out: f.write(json.dumps(o,ensure_ascii=False)+'\n')
print('엣지 도큐먼트:',len(out),'(ref',sum(1 for o in out if o['kind']=='ref'),'/ hier',sum(1 for o in out if o['kind']=='hier'),'/ law',sum(1 for o in out if o['kind']=='law'),')')

# ── 2) 문서간 참조 네트워크(chunk->doc 집계) ──
dd=defaultdict(lambda:{'w':0,'rts':Counter()})
for r in G['ref']:
    if r['tt']!='doc': continue
    s=title[r['sd']]; t=r['tgt']
    if t==s: continue
    dd[(s,t)]['w']+=1; dd[(s,t)]['rts'][r['rt']]+=1
indeg=Counter(); outdeg=Counter()
for (s,t),v in dd.items(): outdeg[s]+=v['w']; indeg[t]+=v['w']
hier=json.load(open('/tmp/reg_hier.json'))
nospace=lambda s:re.sub(r'\s','',s)
hidx={nospace(nfc(h['규정명'])):nfc(h['규정명']) for h in hier}
Hcat={nfc(h['규정명']):(nfc(h['분류']),nfc(h['레벨'])) for h in hier}
CAT={'규정':0,'세칙':1,'지침':2,'매뉴얼':3,'편람':4,'계약서':5}
nodes=sorted(set(title))
nidx={n:i for i,n in enumerate(nodes)}
nl=[[n,CAT.get(Hcat.get(n,('',''))[0],6),indeg.get(n,0),outdeg.get(n,0)] for n in nodes]
de=[[nidx[s],nidx[t],v['w']] for (s,t),v in dd.items() if s in nidx and t in nidx]
net={'n':nl,'e':de}
json.dump(net,open('/tmp/build/docnet.json','w'),ensure_ascii=False,separators=(',',':'))
print('문서간 참조 네트워크: 노드',len(nl),'/ 방향엣지(doc->doc)',len(de))
print('최다 피인용(in):',indeg.most_common(8))
print('최다 인용(out):',outdeg.most_common(8))
print('docnet.json 크기:',len(json.dumps(net,ensure_ascii=False)))
