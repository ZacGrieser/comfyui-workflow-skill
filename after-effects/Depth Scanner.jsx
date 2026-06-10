/**********************************************************************
 * Depth Scanner — for After Effects
 * ------------------------------------------------------------------
 * Recreates the look of the aescripts "Depth Scanner" plug-in using
 * only native After Effects effects, driven by a grayscale DEPTH MAP.
 *
 *   AI depth estimation lives upstream (e.g. a ComfyUI ControlNet
 *   depth preprocessor such as Depth-Anything / MiDaS — see this
 *   repo). This script consumes that depth map and gives you the
 *   Depth-Scanner toolkit inside AE:
 *
 *     • Depth-of-Field   — Compound Blur driven by depth
 *     • Color Map        — Colorama depth visualization (blendable)
 *     • Scan Front       — a glowing contour that sweeps through depth
 *     • Master controls  — one tidy Effect-Controls rig of sliders
 *
 * The whole thing is built from stock effects + expressions, so once
 * applied you can select the effects and do
 *   Animation ▸ Save Animation Preset…  → "Depth Scanner.ffx"
 * to get a real, draggable preset. (.ffx is a binary file that only
 * After Effects can write — this script is the engine that builds it.)
 *
 * USAGE
 *   1. In a comp, select your layer(s):
 *        • 1 layer  → the depth map itself (color-map + scan view)
 *        • 2 layers → your footage + its depth map (DoF/fog + scan)
 *          The depth map is auto-detected by name ("depth"); if it
 *          can't be guessed you'll be asked which is which.
 *   2. Run this script (File ▸ Scripts) or use the docked panel
 *      (drop in ScriptUI Panels and open from the Window menu).
 *   3. Click "Apply Depth Scanner".
 *
 * Tested API: After Effects 2020+ (CC 17+).
 * License: MIT (matches the parent repo).
 *********************************************************************/

(function depthScanner(thisObj) {
    "use strict";

    var SCRIPT_NAME = "Depth Scanner";

    // --- small helpers ---------------------------------------------------

    function activeComp() {
        var c = app.project ? app.project.activeItem : null;
        if (!(c && c instanceof CompItem)) return null;
        return c;
    }

    // Add a named expression-control effect and return it.
    function addControl(layer, matchName, name) {
        var fx = layer.property("ADBE Effect Parade").addProperty(matchName);
        fx.name = name;
        return fx;
    }

    // Safe property set: never abort the whole build on one odd build of AE.
    function trySet(prop, value) {
        try { prop.setValue(value); } catch (e) {}
    }
    function tryExpr(prop, expr) {
        try { prop.expression = expr; } catch (e) {}
    }

    // Guess which of two layers is the depth map (by name).
    function looksLikeDepth(layer) {
        return /depth|disp|midas|zoe|mask|gray|grey/i.test(layer.name);
    }

    // --- the core build --------------------------------------------------

    function buildScanFront(comp, depthLayer, sceneName) {
        // Duplicate the depth map and turn it into a sweeping contour line.
        var scan = depthLayer.duplicate();
        scan.moveToBeginning();
        scan.name = "DS · Scan Front";
        try { scan.blendingMode = BlendingMode.ADD; } catch (e) {}

        var fx = scan.property("ADBE Effect Parade");

        // Threshold: white where depth > scan level → boundary sweeps with it.
        var thr = fx.addProperty("ADBE Threshold2");
        thr.name = "DS Scan · Threshold";
        // AE Threshold "Level" is 0..255; Scan Position control is 0..100.
        tryExpr(thr.property("Level"),
            'var L = thisComp.layer("' + sceneName + '").effect("DS · Scan Position")("Slider");' +
            '\nclamp(L,0,100) * 2.55;');

        // Soften the band by its width before edge detection.
        var box = fx.addProperty("ADBE Box Blur2"); // Fast Box Blur
        box.name = "DS Scan · Width";
        tryExpr(box.property("ADBE Box Blur2-0001"),
            'thisComp.layer("' + sceneName + '").effect("DS · Scan Width")("Slider");');

        // Contour of the moving region = the scan line.
        var edge = fx.addProperty("ADBE Find Edges");
        edge.name = "DS Scan · Contour";
        trySet(edge.property("ADBE Find Edges-0001"), 1); // Invert → white line on black

        // Glow the line.
        var glow = fx.addProperty("ADBE Glo2");
        glow.name = "DS Scan · Glow";
        tryExpr(glow.property("Glow Radius"),
            'var w = thisComp.layer("' + sceneName + '").effect("DS · Scan Width")("Slider");' +
            '\n10 + w * 2;');
        tryExpr(glow.property("Glow Intensity"),
            'thisComp.layer("' + sceneName + '").effect("DS · Scan Glow")("Slider") / 25;');

        // Colorize to the scan color.
        var tint = fx.addProperty("ADBE Tint");
        tint.name = "DS Scan · Color";
        tryExpr(tint.property("ADBE Tint-0002"), // Map White To
            'thisComp.layer("' + sceneName + '").effect("DS · Scan Color")("Color");');

        // Overall scan strength on the layer opacity.
        tryExpr(scan.property("ADBE Transform Group").property("ADBE Opacity"),
            'thisComp.layer("' + sceneName + '").effect("DS · Scan Glow")("Slider");');

        return scan;
    }

    function applyRig(comp, sceneLayer, depthLayer) {
        app.beginUndoGroup(SCRIPT_NAME + ": Apply");

        try {
            var sceneName = sceneLayer.name;

            // ----- Master control rig (the "Depth Scanner" UI) -------------
            var hdr = addControl(sceneLayer, "ADBE Color Control", "▼  DEPTH SCANNER");
            trySet(hdr.property("ADBE Color Control-0001"), [0, 0.8, 1, 1]);

            var depthCtrl = addControl(sceneLayer, "ADBE Layer Control", "DS · Depth Map");
            trySet(depthCtrl.property("ADBE Layer Control-0001"), depthLayer.index);

            var dof   = addControl(sceneLayer, "ADBE Slider Control", "DS · DoF Amount");
            trySet(dof.property("ADBE Slider Control-0001"), 0);

            var colMap = addControl(sceneLayer, "ADBE Slider Control", "DS · Color Map");
            trySet(colMap.property("ADBE Slider Control-0001"), 0); // 0 = off, 100 = full

            var scanPos = addControl(sceneLayer, "ADBE Slider Control", "DS · Scan Position");
            trySet(scanPos.property("ADBE Slider Control-0001"), 50);

            var scanW = addControl(sceneLayer, "ADBE Slider Control", "DS · Scan Width");
            trySet(scanW.property("ADBE Slider Control-0001"), 4);

            var scanColor = addControl(sceneLayer, "ADBE Color Control", "DS · Scan Color");
            trySet(scanColor.property("ADBE Color Control-0001"), [0, 1, 0.65, 1]);

            var scanGlow = addControl(sceneLayer, "ADBE Slider Control", "DS · Scan Glow");
            trySet(scanGlow.property("ADBE Slider Control-0001"), 100);

            // ----- Render: depth-of-field (Compound Blur) ------------------
            var cblur = addControl(sceneLayer, "ADBE Compound Blur", "DS Render · Depth of Field");
            // Blur Layer = the depth map (fixed layer pick — see README note).
            trySet(cblur.property("ADBE Compound Blur-0001"), depthLayer.index);
            tryExpr(cblur.property("ADBE Compound Blur-0002"), // Maximum Blur
                'effect("DS · DoF Amount")("Slider");');
            trySet(cblur.property("ADBE Compound Blur-0004"), true); // Stretch to fit

            // ----- Render: color map (Colorama depth visualization) --------
            var cma = addControl(sceneLayer, "ADBE Colorama", "DS Render · Color Map");
            // "Blend With Original": 100 = effect off, 0 = full color map.
            var blendProp = cma.property("ADBE Colorama-0024") || cma.property("Blend With Original");
            tryExpr(blendProp, '100 - effect("DS · Color Map")("Slider");');

            // ----- Render: the sweeping scan front -------------------------
            buildScanFront(comp, depthLayer, sceneName);

            // Tidy: keep the depth map but hide it as a guide.
            if (depthLayer !== sceneLayer) {
                try { depthLayer.enabled = false; } catch (e) {}
            }

        } catch (err) {
            alert(SCRIPT_NAME + " error:\n" + err.toString());
        } finally {
            app.endUndoGroup();
        }
    }

    // --- entry point -----------------------------------------------------

    function run() {
        var comp = activeComp();
        if (!comp) { alert(SCRIPT_NAME + ":\nOpen a composition first."); return; }

        var sel = comp.selectedLayers;
        if (!sel || sel.length === 0) {
            alert(SCRIPT_NAME + ":\nSelect a layer.\n\n" +
                  "• 1 layer  = the depth map\n" +
                  "• 2 layers = footage + its depth map");
            return;
        }

        var scene, depth;
        if (sel.length === 1) {
            scene = depth = sel[0]; // self-referential depth visualization
        } else {
            var a = sel[0], b = sel[1];
            if (looksLikeDepth(b) && !looksLikeDepth(a))      { scene = a; depth = b; }
            else if (looksLikeDepth(a) && !looksLikeDepth(b)) { scene = b; depth = a; }
            else {
                var topIsDepth = confirm(SCRIPT_NAME + ":\nWhich selected layer is the DEPTH MAP?\n\n" +
                    "OK  = \"" + a.name + "\"\nCancel = \"" + b.name + "\"");
                if (topIsDepth) { depth = a; scene = b; } else { depth = b; scene = a; }
            }
        }
        applyRig(comp, scene, depth);
    }

    function showPresetHelp() {
        alert(SCRIPT_NAME + " — export a .ffx preset\n" +
            "------------------------------------------\n" +
            "1. Apply Depth Scanner to your layer.\n" +
            "2. In Effect Controls, select all the\n" +
            "   \"DS …\" effects (click first, shift-click last).\n" +
            "3. Animation ▸ Save Animation Preset…\n" +
            "4. Save as  Depth Scanner.ffx\n\n" +
            "Drag that .ffx onto any layer to reuse it.");
    }

    // --- UI (dockable panel OR floating palette) -------------------------

    function buildUI(thisObj) {
        var pal = (thisObj instanceof Panel)
            ? thisObj
            : new Window("palette", SCRIPT_NAME, undefined, { resizeable: true });

        var g = pal.add("group");
        g.orientation = "column";
        g.alignChildren = ["fill", "top"];
        g.margins = 12;
        g.spacing = 8;

        var title = g.add("statictext", undefined, "DEPTH SCANNER");
        try { title.graphics.font = ScriptUI.newFont("dialog", "BOLD", 14); } catch (e) {}

        g.add("statictext", undefined,
            "Select a depth map (+ optional footage),\nthen apply.", { multiline: true });

        var apply = g.add("button", undefined, "Apply Depth Scanner");
        apply.onClick = run;

        var help = g.add("button", undefined, "How to export .ffx");
        help.onClick = showPresetHelp;

        var foot = g.add("statictext", undefined, "Depth map from ComfyUI → AE", { multiline: false });
        try { foot.graphics.foreground = foot.graphics.newPen(foot.graphics.PenType.SOLID_COLOR, [0.5, 0.5, 0.5], 1); } catch (e) {}

        if (pal instanceof Window) {
            pal.center();
            pal.show();
        } else {
            pal.layout.layout(true);
        }
        return pal;
    }

    buildUI(thisObj);

})(this);
