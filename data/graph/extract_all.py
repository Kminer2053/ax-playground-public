import json,re,unicodedata
from collections import Counter,defaultdict
nfc=lambda s:unicodedata.normalize('NFC',s or '')
docs=[json.loads(l) for l in open('/tmp/build/all_chunks.jsonl') if l.strip()]
for d in docs:
    d['title']=nfc(d['title']); d['cat']=nfc(d.get('cat',''))
    for a in d['arts']: a['name']=nfc(a['name']); a['text']=nfc(a['text'])
titles=[d['title'] for d in docs]
nospace=lambda s:re.sub(r'\s','',s)
dockey={nospace(t):t for t in titles}
LAWS=['국가를당사자로하는계약에관한법률','국가계약법','지방계약법','전자조달의이용및촉진에관한법률','조달사업에관한법률','하도급거래공정화에관한법률','부정청탁및금품등수수의금지','중소기업제품구매촉진','개인정보보호법','근로기준법','남녀고용평등','산업안전보건법','공공기관의운영에관한법률','상법','민법']
def jonum(name):
    m=re.match(r'제\s*(\d+)\s*조',name); return int(m.group(1)) if m else None
def snip(t,m,w=45):
    s=max(0,m.start()-w); return t[s:m.end()+w].replace('\n',' ')
edges=[]
for di,d in enumerate(docs):
    SELF=d['title']; arts=d['arts']
    jo_idx={}; byp_idx=defaultdict(list); byj_idx=defaultdict(list)
    for c in arts:
        n=c['name']; j=jonum(n)
        if j and '(' in n: jo_idx[j]=c['i']
        mb=re.match(r'별표\s*제(\d+)호(?!\s*별지)',n)
        if mb: byp_idx[int(mb.group(1))].append(c['i'])
        mj=re.match(r'별지\s*제(\d+)호',n)
        if mj: byj_idx[int(mj.group(1))].append(c['i'])
    L={c['i']:len(c['text']) for c in arts}
    pick=lambda idxs: max(idxs,key=lambda i:L.get(i,0)) if idxs else None
    odn=[(nospace(t),t) for t in titles if t!=SELF and len(nospace(t))>=4]
    for c in arts:
        if not c['text'].strip(): continue
        t=c['text']; src=c['i']; selfjo=jonum(c['name']); seen=set()
        for m in re.finditer(r'(.{0,14})제\s*(\d+)\s*조(?:의\s*\d+)?',t):
            pre=m.group(1); j=int(m.group(2))
            if j==selfjo: continue
            if re.search(r'(시행령|시행규칙|」|｣|』|법률|법|령|예규|기준|규칙|고시)\s*$',pre):
                law='국가계약법 시행령' if '시행령' in pre else ('국가계약법 시행규칙' if '시행규칙' in pre else '외부법령')
                mm=re.search(r'[「｢『]([^」｣』]{2,30})[」｣』]\s*$',pre)
                if mm: law=mm.group(1)
                if ('law',law,j) not in seen:
                    seen.add(('law',law,j)); edges.append({'d':di,'src':src,'srcn':c['name'],'type':'외부법령','tgt':law+' 제'+str(j)+'조'})
                continue
            tgt=jo_idx.get(j)
            if tgt is not None and ('jo',tgt) not in seen:
                seen.add(('jo',tgt)); edges.append({'d':di,'src':src,'srcn':c['name'],'type':'내부조문','tgt_i':tgt,'tgt':arts[tgt]['name'],'snip':snip(t,m)})
        for m in re.finditer(r'별표\s*제?\s*(\d+)\s*호',t):
            b=int(m.group(1)); tgt=pick(byp_idx.get(b,[]))
            if tgt is not None and tgt!=src and ('byp',tgt) not in seen:
                seen.add(('byp',tgt)); edges.append({'d':di,'src':src,'srcn':c['name'],'type':'별표','tgt_i':tgt,'tgt':arts[tgt]['name'],'snip':snip(t,m)})
        for m in re.finditer(r'별지\s*제?\s*(\d+)\s*호\s*서식',t):
            b=int(m.group(1)); tgt=pick(byj_idx.get(b,[]))
            if tgt is not None and tgt!=src and ('byj',tgt) not in seen:
                seen.add(('byj',tgt)); edges.append({'d':di,'src':src,'srcn':c['name'],'type':'별지','tgt_i':tgt,'tgt':arts[tgt]['name'],'snip':snip(t,m)})
        tn=nospace(t)
        for k,full in odn:
            if k in tn and ('doc',full) not in seen:
                seen.add(('doc',full))
                pat=re.compile(r'\s*'.join(re.escape(ch) for ch in k))
                mm=pat.search(t); sp=snip(t,mm) if mm else full
                edges.append({'d':di,'src':src,'srcn':c['name'],'type':'외부규정','tgt':full,'snip':sp})
        for law in LAWS:
            if law in tn and ('law2',law) not in seen:
                seen.add(('law2',law)); edges.append({'d':di,'src':src,'srcn':c['name'],'type':'외부법령','tgt':law})
for i,e in enumerate(edges): e['id']=i
json.dump(edges,open('/tmp/build/cand_all.json','w'),ensure_ascii=False)
print('총 후보 엣지:',len(edges))
print('유형별:',dict(Counter(e['type'] for e in edges)))
ver=[e for e in edges if e['type'] in ('내부조문','별표','별지','외부규정')]
print('LLM 검증 대상(외부법령 제외):',len(ver))
print('외부법령(검증 생략):',sum(1 for e in edges if e['type']=='외부법령'))
print('문서별 후보 top10:',Counter(docs[e['d']]['title'] for e in ver).most_common(10))
