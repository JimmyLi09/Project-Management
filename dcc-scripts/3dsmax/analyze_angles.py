# ===== AI ArchViz Director — Phase-2 3ds Max render-node worker =====
# UNTESTED — written against documented pymxs/MAXScript APIs, never run (this
# session's sandbox has no 3ds Max/Arnold install). Expect real debugging on
# an actual node. Polls the same /api/archviz/render-jobs/* HTTP contract as
# scripts/archviz/stub-worker.mjs (Phase 1) and dcc-scripts/sketchup — see
# dcc-scripts/README.md.
#
# Usage (per Handbook §12 — 3ds Max + Arnold is the first-choice render
# node): 3dsmaxbatch analyze_angles.py
# Requires ARCHVIZ_ORCHESTRATOR_URL / ARCHVIZ_WORKER_TOKEN as environment
# variables in the shell that launches 3dsmaxbatch.

import io
import json
import os
import random
import string
import time
import urllib.error
import urllib.request

try:
    from pymxs import runtime as rt
except ImportError:
    raise SystemExit('This script must run inside 3ds Max (3dsmaxbatch) — pymxs not found')

ORCHESTRATOR_URL = os.environ.get('ARCHVIZ_ORCHESTRATOR_URL', 'http://localhost:3000')
WORKER_TOKEN = os.environ.get('ARCHVIZ_WORKER_TOKEN')
POLL_INTERVAL_SEC = 2
WORK_DIR = os.environ.get('ARCHVIZ_WORK_DIR', os.path.join(os.environ.get('TEMP', '.'), 'archviz-worker'))


def log(msg):
    print('[archviz-worker] %s' % msg)


def auth_headers(extra=None):
    h = {'Authorization': 'Bearer %s' % WORKER_TOKEN}
    if extra:
        h.update(extra)
    return h


def http_json(method, path, body=None, headers=None):
    data = json.dumps(body).encode('utf-8') if body is not None else None
    req = urllib.request.Request(ORCHESTRATOR_URL + path, data=data, method=method)
    for k, v in auth_headers(headers).items():
        req.add_header(k, v)
    try:
        with urllib.request.urlopen(req) as res:
            return res.status, res.read()
    except urllib.error.HTTPError as e:
        return e.code, e.read()


def claim_next():
    status, body = http_json('GET', '/api/archviz/render-jobs/next?dcc=3dsmax')
    if status == 204:
        return None
    if status != 200:
        raise RuntimeError('claim failed: %s %s' % (status, body))
    return json.loads(body)


def ensure_model_loaded(job):
    if not os.path.isdir(WORK_DIR):
        os.makedirs(WORK_DIR)
    path = os.path.join(WORK_DIR, '%s.max' % job['modelId'])
    if not os.path.exists(path):
        log('downloading model %s' % job['modelFilename'])
        req = urllib.request.Request(ORCHESTRATOR_URL + job['modelFileUrl'])
        for k, v in auth_headers().items():
            req.add_header(k, v)
        with urllib.request.urlopen(req) as res, open(path, 'wb') as f:
            f.write(res.read())
    # NOTE(untested): re-loading a scene per job is correct but heavy for a
    # busy node — a real deployment likely wants one node process pinned to
    # one open model instead of hot-swapping scenes.
    current = (rt.maxFilePath or '') + (rt.maxFileName or '')
    if job['modelId'] not in current:
        rt.loadMaxFile(path)
    return path


def apply_white_override():
    """White-model material override (Handbook §5.1: diffuse ~0.7 gray, no
    texture, low specular). Returns the original per-object material so it
    can be restored afterwards rather than permanently mutating the scene."""
    white = rt.StandardMaterial()
    white.diffuse = rt.Color(179, 179, 179)
    white.specularLevel = 8
    saved = {}
    for obj in rt.objects:
        saved[obj] = obj.material
        obj.material = white
    return saved


def restore_materials(saved):
    for obj, mat in saved.items():
        try:
            obj.material = mat
        except Exception:
            pass  # object may have been deleted mid-job — not fatal


# NOTE(untested / needs manual verification in Max): Physical_Sun_Sky and
# Skylight availability depends on the active renderer (Arnold vs. the
# scanline default) and 3ds Max version — Handbook §12 specifies Arnold as
# the first-choice render node specifically because it ships sun&sky/GI
# support out of the box, but the exact class names may need adjusting
# against a real install.
def apply_lighting(preset_type, params):
    for light in list(rt.lights):
        if rt.classOf(light).name.startswith('Archviz_'):
            rt.delete(light)

    if preset_type == 'exterior':
        sun_class = getattr(rt, 'Physical_Sun_Sky', None)
        if sun_class:
            sun = sun_class()
            sun.name = 'Archviz_Sun'
            sun.azimuth = params.get('sunAzimuth', 135)
            sun.altitude = params.get('sunElevation', 35)
        else:
            log('WARNING: Physical_Sun_Sky not available on this renderer — exterior lighting skipped')
    else:
        key = rt.Omnilight()
        key.name = 'Archviz_Key'
        key.multiplier = params.get('keyLightIntensity', 0.55) * 3.0
        key.pos = rt.Point3(0, 0, 300)
        sky_class = getattr(rt, 'Skylight', None)
        if sky_class:
            amb = sky_class()
            amb.name = 'Archviz_Ambient'
            amb.multiplier = params.get('ambientLevel', 0.6)


def set_camera(camera_params):
    cam = rt.FreeCamera()
    cam.name = 'Archviz_RenderCam'
    pos = camera_params['position']
    target = camera_params['target']
    # our sampling uses Y-up; 3ds Max is Z-up by convention
    cam.pos = rt.Point3(pos[0], pos[2], pos[1])
    direction = rt.Point3(target[0] - pos[0], target[2] - pos[2], target[1] - pos[1])
    cam.dir = rt.normalize(direction)
    cam.fov = 2 * rt.atan(18.0 / camera_params['fovMm'])
    rt.viewport.setCamera(cam)
    return cam


def render_and_upload(job):
    out_path = os.path.join(WORK_DIR, '%s.png' % job['jobId'])
    rt.rendOutputFilename = out_path
    rt.render(camera=rt.viewport.getCamera(), outputwidth=1600, outputheight=1000, vfb=False)

    boundary = 'ArchvizBoundary' + ''.join(random.choice(string.digits) for _ in range(12))
    with open(out_path, 'rb') as f:
        image_bytes = f.read()
    body = io.BytesIO()
    body.write(('--%s\r\n' % boundary).encode())
    body.write(('Content-Disposition: form-data; name="image"; filename="%s.png"\r\n' % job['jobId']).encode())
    body.write(b'Content-Type: image/png\r\n\r\n')
    body.write(image_bytes)
    body.write(('\r\n--%s--\r\n' % boundary).encode())

    req = urllib.request.Request(
        ORCHESTRATOR_URL + '/api/archviz/render-jobs/%s/complete' % job['jobId'],
        data=body.getvalue(), method='POST',
    )
    for k, v in auth_headers({'Content-Type': 'multipart/form-data; boundary=%s' % boundary}).items():
        req.add_header(k, v)
    with urllib.request.urlopen(req) as res:
        if res.status != 200:
            raise RuntimeError('complete failed: %s' % res.status)
    try:
        os.remove(out_path)
    except OSError:
        pass


def report_failure(job, message):
    try:
        http_json('POST', '/api/archviz/render-jobs/%s/fail' % job['jobId'], {'error': message},
                  {'Content-Type': 'application/json'})
    except Exception as e:
        log('failed to report failure: %s' % e)


def handle_job(job):
    log('rendering %s (%s, %s)' % (job['jobId'], job['camGroup'], job['presetId']))
    ensure_model_loaded(job)
    saved = apply_white_override()
    try:
        apply_lighting(job['presetType'], job['presetParams'])
        set_camera(job['camera'])
        render_and_upload(job)
    finally:
        restore_materials(saved)


def main():
    if not WORKER_TOKEN:
        raise SystemExit('ARCHVIZ_WORKER_TOKEN is required')
    log('starting, polling %s every %ss' % (ORCHESTRATOR_URL, POLL_INTERVAL_SEC))
    while True:
        try:
            job = claim_next()
        except Exception as e:
            log('poll error: %s' % e)
            job = None
        if not job:
            time.sleep(POLL_INTERVAL_SEC)
            continue
        try:
            handle_job(job)
        except Exception as e:
            log('job %s failed: %s' % (job['jobId'], e))
            report_failure(job, str(e))


main()
