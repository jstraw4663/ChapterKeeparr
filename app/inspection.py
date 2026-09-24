"""Source inventory and retained conversion cache; input content defines reuse."""
import json
import os
import re
import shutil
from pathlib import Path
from collections import defaultdict
from . import engine
from .recovery import digest

CONVERSION_VERSION = 'aac-44100-v1'


def manifest(paths, root, ffprobe='ffprobe', check=lambda: None):
    entries = []
    for path in paths:
        check()
        if path.is_symlink() or not path.resolve().is_relative_to(root.resolve()):
            raise engine.NeedsReview('Source points outside this book folder')
        before = engine.fingerprint(path)
        data = engine.probe(ffprobe, path)
        hashed = engine.file_hash(path)
        if engine.fingerprint(path) != before:
            raise engine.NeedsReview('Source changed during inventory')
        entries.append({'path': str(path.relative_to(root)), 'sha256': hashed,
                        'duration_seconds': engine.duration(data), 'tags': engine.tags(data)})
    return {'version': 1, 'files': entries, 'fingerprint': digest(entries),
            'duration_seconds': sum(e['duration_seconds'] for e in entries)}


def sequence_warnings(inventory):
    groups = defaultdict(list)
    for e in inventory['files']:
        if Path(e['path']).suffix.lower() != '.mp3': continue
        groups[(str(Path(e['path']).parent), str(e['tags'].get('disc','1')).split('/')[0])].append(e)
    warnings = []
    discs = []
    for e in inventory['files']:
        if Path(e['path']).suffix.lower() != '.mp3': continue
        tag = re.fullmatch(r'(\d+)(?:/(\d+))?', str(e['tags'].get('disc','')))
        folder = re.fullmatch(r'(?:cd|disc|disk)[ _.-]*(\d+)',Path(e['path']).parent.name,re.I)
        if tag: discs.append((int(tag[1]), int(tag[2]) if tag[2] else None))
        elif folder: discs.append((int(folder[1]),None))
    if discs:
        numbers = {n for n,_ in discs}
        totals = {t for _,t in discs if t is not None}
        end = max(numbers | totals)
        if end > 1000 or len(totals)>1 or numbers != set(range(1,end+1)):
            warnings.append('Disc numbering or totals indicate missing or inconsistent discs')
    for (folder,disc), entries in groups.items():
        tagged = [re.fullmatch(r'(\d+)(?:/(\d+))?',str(e['tags'].get('track',''))) for e in entries]
        filenames = [re.match(r'^(\d+)(?:\D|$)',Path(e['path']).stem) for e in entries]
        matches = tagged if all(tagged) else filenames if all(filenames) else None
        if not matches: continue
        values = [int(m[1]) for m in matches]
        if max(values)>100000: continue
        totals = {int(m[2]) for m in tagged if m and m[2]}
        if values != sorted(values):
            warnings.append(f'{folder}, disc {disc}: track tags disagree with file playback order')
        if len(values) != len(set(values)):
            warnings.append(f'{folder}, disc {disc}: duplicate track numbers')
        expected_start = 0 if min(values)==0 else 1
        missing = sorted(set(range(expected_start,max(values)+1))-set(values))
        if missing: warnings.append(f'{folder}, disc {disc}: numbering gaps {missing[:30]}')
        if len(totals)>1 or (totals and (max(totals) != len(entries) or max(values)>max(totals))):
            warnings.append(f'{folder}, disc {disc}: track totals disagree with the available files')
    return warnings


def unchanged(inventory, root, check=lambda: None):
    expected = inventory['files']
    actual = engine.media_files(root,'.mp3') if expected and Path(expected[0]['path']).suffix.lower()=='.mp3' else [root/e['path'] for e in expected]
    if [str(p.relative_to(root)) for p in actual] != [e['path'] for e in expected]: return False
    for e in expected:
        check()
        path = root/e['path']
        if path.is_symlink() or engine.file_hash(path) != e['sha256']: return False
    return True


def prepared_conversion(root, output, inventory, args, cache_dir, convert):
    """Reuse a validated, fingerprinted intermediate. Never publish from this cache."""
    if not cache_dir: return convert(root,True,args.bitrate,args.ffmpeg,args.ffprobe,output_path=output,already_locked=True)
    cache_dir = Path(cache_dir); cache_dir.mkdir(parents=True,exist_ok=True)
    artwork = []
    for name in ('cover.jpg','cover.jpeg','cover.png','folder.jpg','folder.jpeg','folder.png'):
        path=root/name
        if path.is_file(): artwork.append([name,engine.file_hash(path)])
    version = engine.run([args.ffmpeg, '-version']).decode('utf-8','replace').splitlines()[0]
    key=digest([CONVERSION_VERSION,inventory['fingerprint'],args.bitrate,artwork,version])
    cached=cache_dir/'prepared.m4b'; receipt=cache_dir/'prepared.json'
    if cached.is_file() and receipt.is_file():
        try: saved=json.loads(receipt.read_text())
        except (ValueError, OSError): saved={}
        if saved.get('key')==key and engine.file_hash(cached)==saved.get('sha256'):
            engine.log('Reusing validated conversion; source inventory and cached file fingerprints match')
            shutil.copy2(cached,output)
            if engine.file_hash(output)!=saved['sha256']: raise engine.ConversionError('Retained conversion copy failed integrity verification')
            return True
    if not convert(root,True,args.bitrate,args.ffmpeg,args.ffprobe,output_path=output,already_locked=True): return False
    if not unchanged(inventory,root,getattr(args,'check_cancel',lambda:None)):
        raise engine.NeedsReview('Source inventory changed during conversion; intermediate was not cached')
    limit = max(1,float(os.getenv('CACHE_MAX_GB','10'))) * 1024**3
    # Across retained conversions, stop adding files when the shared budget is used.
    used = sum(p.stat().st_size for p in cache_dir.parents[1].glob('*/prepared/prepared.m4b') if p != cached)
    used += sum(p.stat().st_size for p in (cache_dir.parents[2]/'transcripts').glob('*.json'))
    if used + output.stat().st_size > limit:
        engine.log('Retained conversion cache budget reached; validation continues', 'WARNING')
        return True
    if shutil.disk_usage(cache_dir).free < output.stat().st_size+64*1024**2:
        engine.log('Insufficient cache space to retain conversion; validation continues', 'WARNING')
        return True
    temp=cache_dir/'prepared.partial'; shutil.copy2(output,temp)
    hashed=engine.file_hash(output)
    if engine.file_hash(temp)!=hashed: raise engine.ConversionError('Retained conversion copy failed integrity verification')
    os.replace(temp,cached)
    temp_receipt=cache_dir/'prepared.json.tmp';engine.write_json(temp_receipt,{'key':key,'sha256':hashed})
    os.replace(temp_receipt,receipt)
    return True
