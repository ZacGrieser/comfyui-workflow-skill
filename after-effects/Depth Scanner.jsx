/**********************************************************************
 * Depth Scanner — AI plug-in for After Effects
 * ------------------------------------------------------------------
 * An "AI Depth Scanner": estimates a depth map from your footage with
 * Depth-Anything V2 (run locally via Python), imports it back, and
 * applies a native-effect scanner rig — recreating the aescripts
 * "Depth Scanner" workflow end to end.
 *
 *   [AE footage] --render frames--> [Python: Depth-Anything V2]
 *        --> [grayscale depth PNGs] --import--> [AE]
 *        --> Depth-of-Field + Color Map + sweeping Scan Front
 *
 * Two ways to work:
 *   • AI:   select footage, click "Estimate Depth (AI)" — the panel
 *           renders the frame(s), runs the model, imports depth, and
 *           applies the rig automatically.
 *   • Manual: already have a depth map (e.g. from a ComfyUI ControlNet
 *           depth preprocessor)? Select footage + depth and click
 *           "Apply to selection".
 *
 * The rig is built from stock effects + expressions, so you can select
 * the "DS …" effects and  Animation ▸ Save Animation Preset…  to get a
 * real, draggable  Depth Scanner.ffx.
 *
 * SETUP (one time):
 *   1. pip install -r requirements.txt   (next to this script)
 *   2. AE ▸ Preferences ▸ Scripting & Expressions ▸
 *        "Allow Scripts to Write Files and Access Network"  → ON
 *   3. In the panel, set the Python path if "python3" isn't on PATH
 *      (GUI-launched AE often can't see your shell PATH — use the full
 *       path to a venv python, e.g. /path/to/venv/bin/python).
 *
 * Tested API: After Effects 2020+ (CC 17+).
 * License: MIT (matches the parent repo).
 *********************************************************************/

(function depthScanner(thisObj) {
    "use strict";

    var SCRIPT_NAME = "Depth Scanner";
    var SETTINGS = "DepthScanner";
    var IS_WIN = ($.os.indexOf("Windows") !== -1);
    var OPT_DOTS = false; // "point-cloud dots" mode (set by the UI checkbox)

    // --- settings persistence -------------------------------------------

    function getPref(key, def) {
        try {
            if (app.settings.haveSetting(SETTINGS, key)) {
                return app.settings.getSetting(SETTINGS, key);
            }
        } catch (e) {}
        return def;
    }
    function setPref(key, val) {
        try { app.settings.saveSetting(SETTINGS, key, String(val)); } catch (e) {}
    }

    function scriptDir() {
        try { return File($.fileName).parent; } catch (e) { return Folder.temp; }
    }

    // --- small helpers ---------------------------------------------------

    function activeComp() {
        var c = app.project ? app.project.activeItem : null;
        return (c && c instanceof CompItem) ? c : null;
    }
    function addControl(layer, matchName, name) {
        var fx = layer.property("ADBE Effect Parade").addProperty(matchName);
        fx.name = name;
        return fx;
    }
    function trySet(prop, value) { try { prop.setValue(value); } catch (e) {} }
    function tryExpr(prop, expr) { try { prop.expression = expr; } catch (e) {} }
    function looksLikeDepth(layer) {
        return /depth|disp|midas|zoe|mask|gray|grey/i.test(layer.name);
    }
    function quote(s) { return '"' + String(s).replace(/"/g, '') + '"'; }

    // ====================================================================
    //  EFFECT RIG
    // ====================================================================

    function buildScanFront(depthLayer, sceneName) {
        var scan = depthLayer.duplicate();
        scan.moveToBeginning();
        scan.name = "DS · Scan Front";
        try { scan.blendingMode = BlendingMode.ADD; } catch (e) {}
        var fx = scan.property("ADBE Effect Parade");

        var thr = fx.addProperty("ADBE Threshold2");
        thr.name = "DS Scan · Threshold";
        tryExpr(thr.property("Level"),
            'var L = thisComp.layer("' + sceneName + '").effect("DS · Scan Position")("Slider");' +
            '\nclamp(L,0,100) * 2.55;');

        var box = fx.addProperty("ADBE Box Blur2");
        box.name = "DS Scan · Width";
        tryExpr(box.property("ADBE Box Blur2-0001"),
            'thisComp.layer("' + sceneName + '").effect("DS · Scan Width")("Slider");');

        var edge = fx.addProperty("ADBE Find Edges");
        edge.name = "DS Scan · Contour";
        trySet(edge.property("ADBE Find Edges-0001"), 1);

        // Optional: turn the scan line into a grid of balls (point cloud).
        if (OPT_DOTS) {
            try {
                var ball = fx.addProperty("CC Ball Action");
                ball.name = "DS Scan · Point Cloud";
                tryExpr(ball.property("Grid Spacing"),
                    'thisComp.layer("' + sceneName + '").effect("DS · Dot Grid")("Slider");');
                tryExpr(ball.property("Ball Size"),
                    'thisComp.layer("' + sceneName + '").effect("DS · Dot Grid")("Slider") * 0.9;');
            } catch (e) {}
        }

        var glow = fx.addProperty("ADBE Glo2");
        glow.name = "DS Scan · Glow";
        tryExpr(glow.property("Glow Radius"),
            'var w = thisComp.layer("' + sceneName + '").effect("DS · Scan Width")("Slider");' +
            '\n10 + w * 2;');
        tryExpr(glow.property("Glow Intensity"),
            'thisComp.layer("' + sceneName + '").effect("DS · Scan Glow")("Slider") / 25;');

        var tint = fx.addProperty("ADBE Tint");
        tint.name = "DS Scan · Color";
        tryExpr(tint.property("ADBE Tint-0002"),
            'thisComp.layer("' + sceneName + '").effect("DS · Scan Color")("Color");');

        tryExpr(scan.property("ADBE Transform Group").property("ADBE Opacity"),
            'thisComp.layer("' + sceneName + '").effect("DS · Scan Glow")("Slider");');
        return scan;
    }

    // Atmospheric depth fog: an inverted depth duplicate tinted to the fog
    // color, in Add blend, so far areas fade toward fog and near areas don't.
    function buildFog(depthLayer, sceneName) {
        var fog = depthLayer.duplicate();
        fog.moveToBeginning();
        fog.name = "DS · Fog";
        try { fog.blendingMode = BlendingMode.ADD; } catch (e) {}
        var fx = fog.property("ADBE Effect Parade");

        fx.addProperty("ADBE Invert").name = "DS Fog · Far = bright"; // near→black, far→white

        var tint = fx.addProperty("ADBE Tint");
        tint.name = "DS Fog · Color";
        tryExpr(tint.property("ADBE Tint-0002"), // Map White To
            'thisComp.layer("' + sceneName + '").effect("DS · Fog Color")("Color");');

        tryExpr(fog.property("ADBE Transform Group").property("ADBE Opacity"),
            'thisComp.layer("' + sceneName + '").effect("DS · Fog Density")("Slider");');
        return fog;
    }

    function applyRig(sceneLayer, depthLayer) {
        app.beginUndoGroup(SCRIPT_NAME + ": Apply");
        try {
            var sceneName = sceneLayer.name;

            var hdr = addControl(sceneLayer, "ADBE Color Control", "▼  DEPTH SCANNER");
            trySet(hdr.property("ADBE Color Control-0001"), [0, 0.8, 1, 1]);

            var depthCtrl = addControl(sceneLayer, "ADBE Layer Control", "DS · Depth Map");
            trySet(depthCtrl.property("ADBE Layer Control-0001"), depthLayer.index);

            var dof = addControl(sceneLayer, "ADBE Slider Control", "DS · DoF Amount");
            trySet(dof.property("ADBE Slider Control-0001"), 0);
            var colMap = addControl(sceneLayer, "ADBE Slider Control", "DS · Color Map");
            trySet(colMap.property("ADBE Slider Control-0001"), 0);
            var scanPos = addControl(sceneLayer, "ADBE Slider Control", "DS · Scan Position");
            trySet(scanPos.property("ADBE Slider Control-0001"), 50);
            var scanW = addControl(sceneLayer, "ADBE Slider Control", "DS · Scan Width");
            trySet(scanW.property("ADBE Slider Control-0001"), 4);
            var scanColor = addControl(sceneLayer, "ADBE Color Control", "DS · Scan Color");
            trySet(scanColor.property("ADBE Color Control-0001"), [0, 1, 0.65, 1]);
            var scanGlow = addControl(sceneLayer, "ADBE Slider Control", "DS · Scan Glow");
            trySet(scanGlow.property("ADBE Slider Control-0001"), 100);
            var dotGrid = addControl(sceneLayer, "ADBE Slider Control", "DS · Dot Grid");
            trySet(dotGrid.property("ADBE Slider Control-0001"), 12);
            var fogColor = addControl(sceneLayer, "ADBE Color Control", "DS · Fog Color");
            trySet(fogColor.property("ADBE Color Control-0001"), [0.55, 0.65, 0.8, 1]);
            var fogDensity = addControl(sceneLayer, "ADBE Slider Control", "DS · Fog Density");
            trySet(fogDensity.property("ADBE Slider Control-0001"), 0); // off by default

            var cblur = addControl(sceneLayer, "ADBE Compound Blur", "DS Render · Depth of Field");
            trySet(cblur.property("ADBE Compound Blur-0001"), depthLayer.index);
            tryExpr(cblur.property("ADBE Compound Blur-0002"), 'effect("DS · DoF Amount")("Slider");');
            trySet(cblur.property("ADBE Compound Blur-0004"), true);

            var cma = addControl(sceneLayer, "ADBE Colorama", "DS Render · Color Map");
            var blendProp = cma.property("ADBE Colorama-0024") || cma.property("Blend With Original");
            tryExpr(blendProp, '100 - effect("DS · Color Map")("Slider");');

            buildFog(depthLayer, sceneName);
            buildScanFront(depthLayer, sceneName);

            if (depthLayer !== sceneLayer) {
                try { depthLayer.enabled = false; } catch (e) {}
            }
        } catch (err) {
            alert(SCRIPT_NAME + " error:\n" + err.toString());
        } finally {
            app.endUndoGroup();
        }
    }

    function resolveSelection(comp) {
        // Returns {scene, depth} from the current selection, or null.
        var sel = comp.selectedLayers;
        if (!sel || sel.length === 0) return null;
        if (sel.length === 1) return { scene: sel[0], depth: sel[0] };
        var a = sel[0], b = sel[1];
        if (looksLikeDepth(b) && !looksLikeDepth(a)) return { scene: a, depth: b };
        if (looksLikeDepth(a) && !looksLikeDepth(b)) return { scene: b, depth: a };
        var topIsDepth = confirm(SCRIPT_NAME + ":\nWhich selected layer is the DEPTH MAP?\n\n" +
            "OK = \"" + a.name + "\"\nCancel = \"" + b.name + "\"");
        return topIsDepth ? { scene: b, depth: a } : { scene: a, depth: b };
    }

    function runManual() {
        var comp = activeComp();
        if (!comp) { alert(SCRIPT_NAME + ":\nOpen a composition first."); return; }
        var pair = resolveSelection(comp);
        if (!pair) {
            alert(SCRIPT_NAME + ":\nSelect a layer.\n\n" +
                  "• 1 layer  = the depth map\n" +
                  "• 2 layers = footage + its depth map");
            return;
        }
        applyRig(pair.scene, pair.depth);
    }

    // ====================================================================
    //  AI DEPTH (Depth-Anything V2 via Python)
    // ====================================================================

    function tempJob() {
        var base = new Folder(Folder.temp.fsName + "/DepthScanner_" + (new Date().getTime()));
        var inDir = new Folder(base.fsName + "/in");
        var outDir = new Folder(base.fsName + "/out");
        inDir.create(); outDir.create();
        return { inDir: inDir, outDir: outDir };
    }

    // Render the selected footage layer (soloed) to PNG frames in inDir.
    function exportFrames(comp, layer, inDir, wholeRange) {
        var solos = [];
        for (var i = 1; i <= comp.numLayers; i++) {
            solos.push(comp.layer(i).solo);
            comp.layer(i).solo = false;
        }
        layer.solo = true;

        var written = [];
        try {
            if (wholeRange) {
                var fps = comp.frameRate;
                var t = comp.workAreaStart;
                var end = comp.workAreaStart + comp.workAreaDuration - comp.frameDuration / 2;
                var n = 0;
                while (t <= end) {
                    n++;
                    var f = new File(inDir.fsName + "/frame_" + pad(n, 5) + ".png");
                    comp.saveFrameToPng(t, f);
                    written.push(f);
                    t += comp.frameDuration;
                }
            } else {
                var fc = new File(inDir.fsName + "/frame_00001.png");
                comp.saveFrameToPng(comp.time, fc);
                written.push(fc);
            }
        } finally {
            for (var j = 1; j <= comp.numLayers; j++) comp.layer(j).solo = solos[j - 1];
        }
        return written;
    }

    function pad(n, w) {
        var s = String(n);
        while (s.length < w) s = "0" + s;
        return s;
    }

    function runDepthModel(inDir, outDir, encoder, normalize) {
        var py = getPref("python", "python3");
        var script = new File(scriptDir().fsName + "/depth_estimate.py");
        if (!script.exists) {
            alert(SCRIPT_NAME + ":\nCan't find depth_estimate.py next to this script:\n" + script.fsName);
            return false;
        }
        var cmd = [
            quote(py), quote(script.fsName),
            "-i", quote(inDir.fsName),
            "-o", quote(outDir.fsName),
            "--encoder", encoder,
            "--normalize", normalize
        ].join(" ") + " 2>&1";

        if (!IS_WIN) cmd = "/bin/sh -c " + quote(cmd);
        var result = system.callSystem(cmd);

        // Did anything land in outDir?
        var outs = outDir.getFiles("*.png");
        if (!outs || outs.length === 0) {
            alert(SCRIPT_NAME + " — depth model produced no output.\n\n" +
                  "Command:\n" + cmd + "\n\nOutput:\n" + result);
            return false;
        }
        return true;
    }

    function importDepth(outDir, asSequence) {
        var files = outDir.getFiles("*.png");
        files.sort(function (a, b) { return a.fsName < b.fsName ? -1 : 1; });
        if (!files.length) return null;
        var io = new ImportOptions(files[0]);
        if (asSequence && files.length > 1) {
            try { io.sequence = true; io.forceAlphabetical = true; } catch (e) {}
        }
        return app.project.importFile(io);
    }

    function runAI(wholeRange) {
        var comp = activeComp();
        if (!comp) { alert(SCRIPT_NAME + ":\nOpen a composition first."); return; }
        var sel = comp.selectedLayers;
        if (!sel || sel.length === 0) { alert(SCRIPT_NAME + ":\nSelect the footage layer to scan."); return; }
        var scene = sel[0];

        var encoder = getPref("encoder", "vits");
        var normalize = wholeRange ? "global" : "frame";

        app.beginUndoGroup(SCRIPT_NAME + ": AI Depth");
        var depthLayer = null;
        try {
            var job = tempJob();
            var frames = exportFrames(comp, scene, job.inDir, wholeRange);
            if (!frames.length) { alert(SCRIPT_NAME + ":\nNothing was rendered."); return; }

            if (!runDepthModel(job.inDir, job.outDir, encoder, normalize)) return;

            var footage = importDepth(job.outDir, wholeRange);
            if (!footage) { alert(SCRIPT_NAME + ":\nDepth maps were not imported."); return; }
            footage.name = scene.name + " depth";

            depthLayer = comp.layers.add(footage);
            depthLayer.moveAfter(scene);
            depthLayer.name = scene.name + " depth";
        } catch (err) {
            alert(SCRIPT_NAME + " AI error:\n" + err.toString());
            app.endUndoGroup();
            return;
        }
        app.endUndoGroup();

        if (depthLayer) applyRig(scene, depthLayer);
    }

    // ====================================================================
    //  PRESET HELP
    // ====================================================================

    function showPresetHelp() {
        alert(SCRIPT_NAME + " — export a .ffx preset\n" +
            "------------------------------------------\n" +
            "1. Apply Depth Scanner to your layer.\n" +
            "2. In Effect Controls, select all the \"DS …\"\n" +
            "   effects (click first, shift-click last).\n" +
            "3. Animation ▸ Save Animation Preset…\n" +
            "4. Save as  Depth Scanner.ffx\n\n" +
            "Drag that .ffx onto any layer to reuse it.");
    }

    // ====================================================================
    //  UI
    // ====================================================================

    function buildUI(thisObj) {
        var pal = (thisObj instanceof Panel)
            ? thisObj
            : new Window("palette", SCRIPT_NAME, undefined, { resizeable: true });

        var root = pal.add("group");
        root.orientation = "column";
        root.alignChildren = ["fill", "top"];
        root.margins = 12;
        root.spacing = 8;

        var title = root.add("statictext", undefined, "DEPTH SCANNER  ·  AI");
        try { title.graphics.font = ScriptUI.newFont("dialog", "BOLD", 14); } catch (e) {}

        // --- AI panel ---
        var ai = root.add("panel", undefined, "AI Depth (Depth-Anything V2)");
        ai.orientation = "column";
        ai.alignChildren = ["fill", "top"];
        ai.margins = 10; ai.spacing = 6;

        var pyRow = ai.add("group");
        pyRow.add("statictext", undefined, "Python:");
        var pyField = pyRow.add("edittext", undefined, getPref("python", "python3"));
        pyField.characters = 22;
        pyField.onChange = function () { setPref("python", pyField.text); };
        var pyBtn = pyRow.add("button", undefined, "…");
        pyBtn.maximumSize = [30, 24];
        pyBtn.onClick = function () {
            var f = File.openDialog("Select the Python executable");
            if (f) { pyField.text = f.fsName; setPref("python", f.fsName); }
        };

        var modRow = ai.add("group");
        modRow.add("statictext", undefined, "Model:");
        var modDD = modRow.add("dropdownlist", undefined, ["vits — fast", "vitb — balanced", "vitl — best"]);
        var encMap = ["vits", "vitb", "vitl"];
        var curEnc = getPref("encoder", "vits");
        modDD.selection = (curEnc === "vitl") ? 2 : (curEnc === "vitb") ? 1 : 0;
        modDD.onChange = function () { setPref("encoder", encMap[modDD.selection.index]); };

        var aiFrame = ai.add("button", undefined, "Estimate Depth (current frame)");
        aiFrame.onClick = function () { runAI(false); };
        var aiRange = ai.add("button", undefined, "Estimate Depth (work area)");
        aiRange.onClick = function () { runAI(true); };

        // --- Look options (apply to both AI and Manual) ---
        OPT_DOTS = (getPref("dots", "0") === "1");
        var look = root.add("panel", undefined, "Look");
        look.orientation = "column";
        look.alignChildren = ["left", "top"];
        look.margins = 10; look.spacing = 4;
        var dotsCb = look.add("checkbox", undefined, "Point-cloud dots (scan front)");
        dotsCb.value = OPT_DOTS;
        dotsCb.onClick = function () { OPT_DOTS = dotsCb.value; setPref("dots", OPT_DOTS ? "1" : "0"); };
        look.add("statictext", undefined, "Fog: set DS · Fog Density > 0 after applying.");

        // --- Manual panel ---
        var man = root.add("panel", undefined, "Manual (have a depth map)");
        man.orientation = "column";
        man.alignChildren = ["fill", "top"];
        man.margins = 10; man.spacing = 6;
        man.add("statictext", undefined, "Select footage + depth, then:", { multiline: false });
        var applyBtn = man.add("button", undefined, "Apply to selection");
        applyBtn.onClick = runManual;

        var help = root.add("button", undefined, "How to export .ffx");
        help.onClick = showPresetHelp;

        var foot = root.add("statictext", undefined, "Depth-Anything V2 · local · MIT");
        try { foot.graphics.foreground = foot.graphics.newPen(foot.graphics.PenType.SOLID_COLOR, [0.5, 0.5, 0.5], 1); } catch (e) {}

        if (pal instanceof Window) { pal.center(); pal.show(); }
        else { pal.layout.layout(true); pal.layout.resize(); }
        return pal;
    }

    buildUI(thisObj);

})(this);
