# ===== AI ArchViz Director — Phase-2 SketchUp render-node worker =====
# UNTESTED — written against the documented SketchUp Ruby API, never run.
# This session's sandbox has no SketchUp install, so expect real debugging
# once this runs against actual SketchUp. It polls the same
# /api/archviz/render-jobs/* HTTP contract as scripts/archviz/stub-worker.mjs
# (Phase 1) — see dcc-scripts/README.md for how the two relate and how to
# deploy this.
#
# Usage: open a model in SketchUp, then in the Ruby Console:
#   load 'dcc-scripts/sketchup/analyze_angles.rb'
# (or require it from a startup .rbs plugin so it runs headless-ish on
# launch). Requires ARCHVIZ_ORCHESTRATOR_URL / ARCHVIZ_WORKER_TOKEN as
# environment variables SketchUp inherits at launch.

require 'net/http'
require 'json'
require 'uri'
require 'fileutils'
require 'tmpdir'

module ArchvizWorker
  ORCHESTRATOR_URL = ENV['ARCHVIZ_ORCHESTRATOR_URL'] || 'http://localhost:3000'
  WORKER_TOKEN = ENV['ARCHVIZ_WORKER_TOKEN']
  POLL_INTERVAL = 2 # seconds
  WORK_DIR = File.join(Dir.tmpdir, 'archviz-worker')

  def self.log(msg)
    puts "[archviz-worker] #{msg}"
  end

  def self.auth_headers(extra = {})
    { 'Authorization' => "Bearer #{WORKER_TOKEN}" }.merge(extra)
  end

  def self.request(method_class, path, body: nil, extra_headers: {})
    uri = URI.join(ORCHESTRATOR_URL, path)
    req = method_class.new(uri)
    auth_headers(extra_headers).each { |k, v| req[k] = v }
    req.body = body if body
    Net::HTTP.start(uri.host, uri.port, use_ssl: uri.scheme == 'https') { |http| http.request(req) }
  end

  def self.claim_next
    res = request(Net::HTTP::Get, '/api/archviz/render-jobs/next?dcc=sketchup')
    return nil if res.code.to_i == 204
    raise "claim failed: #{res.code} #{res.body}" unless res.code.to_i == 200

    JSON.parse(res.body)
  end

  def self.ensure_model_loaded(job)
    FileUtils.mkdir_p(WORK_DIR)
    path = File.join(WORK_DIR, "#{job['modelId']}.skp")
    unless File.exist?(path)
      log "downloading model #{job['modelFilename']}"
      uri = URI.join(ORCHESTRATOR_URL, job['modelFileUrl'])
      req = Net::HTTP::Get.new(uri)
      auth_headers.each { |k, v| req[k] = v }
      Net::HTTP.start(uri.host, uri.port, use_ssl: uri.scheme == 'https') do |http|
        http.request(req) do |res|
          raise "download failed: #{res.code}" unless res.code.to_i == 200

          File.open(path, 'wb') { |f| res.read_body { |chunk| f.write(chunk) } }
        end
      end
    end
    # NOTE(untested): Sketchup.open_file replaces the active model wholesale;
    # if a render node handles multiple different models across jobs this
    # reopen-per-job approach is correct but slow — a real deployment likely
    # wants one dedicated node process per open model instead.
    Sketchup.open_file(path) if Sketchup.active_model.nil? || Sketchup.active_model.path != path
    path
  end

  # White-model material override (Handbook §5.1 — "中性白/浅灰，不加真实材质").
  # Saves each face's original materials so they can be restored afterwards
  # rather than permanently mutating the designer's source file.
  def self.apply_white_override(model)
    white = model.materials['ArchvizWhiteOverride'] || model.materials.add('ArchvizWhiteOverride')
    white.color = Sketchup::Color.new(230, 230, 225)
    saved = {}
    model.entities.grep(Sketchup::Face).each do |face|
      saved[face.entityID] = [face.material, face.back_material]
      face.material = white
      face.back_material = white
    end
    saved
  end

  def self.restore_materials(model, saved)
    model.entities.grep(Sketchup::Face).each do |face|
      orig = saved[face.entityID]
      next unless orig

      face.material = orig[0]
      face.back_material = orig[1]
    end
  end

  def self.set_camera(view, camera_params)
    eye = Geom::Point3d.new(*camera_params['position'])
    target = Geom::Point3d.new(*camera_params['target'])
    up = Geom::Vector3d.new(*camera_params['up'])
    view.camera = Sketchup::Camera.new(eye, target, up, false)
    # fovMm here is a focal-length-style value (24/28/35/50 on a 36mm
    # sensor), not a direct FOV — convert to the vertical FOV SketchUp wants.
    view.camera.fov = 2 * Math.atan(18.0 / camera_params['fovMm'].to_f) * 180 / Math::PI
  end

  # NOTE(untested / needs manual tuning): SketchUp's native shadow system
  # (model.shadow_info) drives the sun from a Time + geographic location, not
  # a direct azimuth/elevation pair — there's no built-in "set sun to exactly
  # 135°/35°" call. Interior ambient+GI has no native equivalent at all;
  # Handbook §3.71 already flags that the interior preset needs V-Ray or
  # Enscape on the SketchUp side. This is left as an honest placeholder —
  # see dcc-scripts/README.md.
  def self.apply_lighting(model, preset_type, _params)
    return unless preset_type == 'exterior'

    model.shadow_info['DisplayShadows'] = true
    # TODO: derive a Time whose sun azimuth/elevation approximates
    # presetParams.sunAzimuth/sunElevation for this model's geo-location, or
    # switch to a plugin (V-Ray/Enscape) that accepts azimuth/elevation
    # directly.
  end

  def self.render_and_upload(job, view)
    tmp_png = File.join(WORK_DIR, "#{job['jobId']}.png")
    view.write_image(filename: tmp_png, width: 1600, height: 1000, antialias: true, transparent: false)

    boundary = "ArchvizBoundary#{rand(1_000_000_000)}"
    image_bytes = File.binread(tmp_png)
    body = +''
    body << "--#{boundary}\r\n"
    body << "Content-Disposition: form-data; name=\"image\"; filename=\"#{job['jobId']}.png\"\r\n"
    body << "Content-Type: image/png\r\n\r\n"
    body << image_bytes
    body << "\r\n--#{boundary}--\r\n"
    res = request(Net::HTTP::Post, "/api/archviz/render-jobs/#{job['jobId']}/complete",
                   body: body, extra_headers: { 'Content-Type' => "multipart/form-data; boundary=#{boundary}" })
    raise "complete failed: #{res.code} #{res.body}" unless res.code.to_i == 200

    File.delete(tmp_png)
  rescue StandardError
    nil # best-effort cleanup
  end

  def self.report_failure(job, message)
    request(Net::HTTP::Post, "/api/archviz/render-jobs/#{job['jobId']}/fail",
            body: { error: message }.to_json, extra_headers: { 'Content-Type' => 'application/json' })
  rescue StandardError => e
    log "failed to report failure: #{e.message}"
  end

  def self.handle_job(job)
    log "rendering #{job['jobId']} (#{job['camGroup']}, #{job['presetId']})"
    ensure_model_loaded(job)
    model = Sketchup.active_model
    view = model.active_view
    saved_materials = apply_white_override(model)
    begin
      apply_lighting(model, job['presetType'], job['presetParams'])
      set_camera(view, job['camera'])
      render_and_upload(job, view)
    ensure
      restore_materials(model, saved_materials)
    end
  rescue StandardError => e
    log "job #{job['jobId']} failed: #{e.message}\n#{e.backtrace&.join("\n")}"
    report_failure(job, e.message)
  end

  def self.poll_once
    job = claim_next
    handle_job(job) if job
  rescue StandardError => e
    log "poll error: #{e.message}"
  end

  # SketchUp is single-threaded and UI-driven — a blocking `while true` loop
  # would freeze the app, so this uses a repeating UI timer instead.
  def self.start
    raise 'ARCHVIZ_WORKER_TOKEN is required' unless WORKER_TOKEN

    log "starting, polling #{ORCHESTRATOR_URL} every #{POLL_INTERVAL}s"
    @timer = UI.start_timer(POLL_INTERVAL, true) { poll_once }
  end

  def self.stop
    UI.stop_timer(@timer) if @timer
  end
end

ArchvizWorker.start
