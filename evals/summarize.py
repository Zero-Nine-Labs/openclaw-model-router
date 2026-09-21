#!/usr/bin/env python3
import argparse, collections, json, math
from pathlib import Path
p=argparse.ArgumentParser();p.add_argument('results');p.add_argument('--output',required=True);a=p.parse_args()
rows=[json.loads(x) for x in Path(a.results).read_text().splitlines() if x.strip()]
valid=[r for r in rows if r['result'].get('ok')]
latencies=sorted(r['result']['latencyMs'] for r in valid)
def percentile(q):return latencies[max(0,math.ceil(len(latencies)*q)-1)] if latencies else None
bycase=collections.defaultdict(list)
for row in rows:bycase[row['id']].append(row)
summary={
 'trials':len(rows),'validAssessments':len(valid),'passedTrials':sum(r['passed'] for r in rows),
 'acceptableProfiles':sum(r['result'].get('ok') and r['result']['route']['profile'] in r['expected']['profiles'] for r in rows),
 'cases':len(bycase),'casesPassingEveryRepeat':sum(all(r['passed'] for r in group) for group in bycase.values()),
 'casesWithIdenticalProfile':sum(len({r['result'].get('route',{}).get('profile') for r in group})==1 for group in bycase.values()),
 'latencyMs':{'p50':percentile(.5),'p95':percentile(.95),'max':max(latencies) if latencies else None},
 'errors':dict(collections.Counter(r['result'].get('error') for r in rows if not r['result'].get('ok'))),
 'failures':[{'id':r['id'],'repeat':r['repeat'],'failures':r['failures'],'assessment':r['result'].get('assessment'),'route':r['result'].get('route')} for r in rows if not r['passed']],
 'profilesByCase':{k:[r['result'].get('route',{}).get('profile') for r in v] for k,v in bycase.items()},
 'tokenUsage':{key:sum(r['result'].get('usage',{}).get(key,0) for r in rows) for key in ['inputTokens','outputTokens','cacheReadTokens','cacheWriteTokens','totalTokens']},
 'classifierCostReportedUsd':sum(r['result'].get('usage',{}).get('costUsd',0) or 0 for r in valid),
 'trialsWithReportedCost':sum(isinstance(r['result'].get('usage',{}).get('costUsd'),(int,float)) for r in valid),
 'executionCostUsd':None,
 'notes':['Labels were fixed before the run. Repetitions of the same case are correlated; this is not a population accuracy confidence estimate.','Acceptable route ranges are policy judgments, not proof of the selected model solving the task.','Classifier cost is summed only where reported; failed calls may have unknown cost. Execution cost is not measured.']
}
Path(a.output).write_text(json.dumps(summary,indent=2)+'\n');print(json.dumps({k:v for k,v in summary.items() if k not in ['failures','profilesByCase','notes']},indent=2))
