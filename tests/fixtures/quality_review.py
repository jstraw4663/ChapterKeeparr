"""Synthetic recording/catalog evidence; never publish this generated preview."""
from app import recovery


def fixture(count=10):
    titles=['Opening Credits']+[f'Chapter {i}' for i in range(1,count-1)]+['End Credits']
    remote=[dict(title=t,start=float(i*100),end=float((i+1)*100)) for i,t in enumerate(titles)]
    markers=[dict(old_title=f'Track {i+1}',old_seconds=c['start'],new_seconds=c['start'],
        title=c['title'] if 0<i<count-1 else None,reference_start=c['start'] if 0<i<count-1 else None,
        status='supported' if 0<i<count-1 else 'unresolved',confidence='spoken heading' if 0<i<count-1 else 'unconfirmed') for i,c in enumerate(remote)]
    return dict(edition={'asin':'B000000001','title':'Book','narrators':'Reader'},recovery_draft=dict(complete=True,source_sha256='a'*64,
        duration_seconds=count*100,total_markers=count,markers=markers,reference_chapters=remote,timeline_hash=recovery.digest(remote)))
