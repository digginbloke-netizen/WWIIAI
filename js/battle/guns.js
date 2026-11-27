// Detailed firearm models with real iron-sight geometry.
// Coordinates: x = right, y = up, z = forward is NEGATIVE. Origin is at the trigger.
// Every part carries a material tag: wood | metal | dark | brass | canvas.
import * as THREE from 'three';

// Side profile (u = distance forward of the trigger, v = height) extruded to thickness w.
function profile(pts, w, bevel = 0.004) {
  const s = new THREE.Shape(pts.map(([u, v]) => new THREE.Vector2(u, v)));
  const g = new THREE.ExtrudeGeometry(s, { depth: Math.max(0.001, w - bevel * 2), bevelEnabled: true, bevelThickness: bevel, bevelSize: bevel, bevelSegments: 2, curveSegments: 6 });
  g.translate(0, 0, -(w - bevel * 2) / 2);
  g.rotateY(Math.PI / 2); // +u -> -z
  return g;
}
// Cylinder along the bore axis between u0 and u1 (forward distances).
function tube(r0, r1, u0, u1, y = 0, x = 0, seg = 12) {
  const g = new THREE.CylinderGeometry(r1, r0, u1 - u0, seg);
  g.rotateX(-Math.PI / 2);                  // +y -> -z
  g.translate(x, y, -(u0 + u1) / 2);
  return g;
}
function box(w, h, d, x, y, u) { const g = new THREE.BoxGeometry(w, h, d); g.translate(x, y, -u); return g; }
function rbox(w, h, d, x, y, u, r = 0.006) {
  const s = new THREE.Shape(); const hw = w / 2 - r, hh = h / 2 - r;
  s.moveTo(-hw, -h / 2); s.lineTo(hw, -h / 2); s.quadraticCurveTo(w / 2, -h / 2, w / 2, -hh); s.lineTo(w / 2, hh);
  s.quadraticCurveTo(w / 2, h / 2, hw, h / 2); s.lineTo(-hw, h / 2); s.quadraticCurveTo(-w / 2, h / 2, -w / 2, hh);
  s.lineTo(-w / 2, -hh); s.quadraticCurveTo(-w / 2, -h / 2, -hw, -h / 2);
  const g = new THREE.ExtrudeGeometry(s, { depth: d, bevelEnabled: false, curveSegments: 3 });
  g.translate(x, y, -u - d / 2);
  return g;
}
function ring(r, t, x, y, u, seg = 16) { const g = new THREE.TorusGeometry(r, t, 6, seg); g.translate(x, y, -u); return g; }

const C = { wood: 0x7a4f2c, wood2: 0x6a4224, metal: 0x34373a, park: 0x3c403a, dark: 0x1c1a18, brass: 0xb08a3c, canvas: 0x6e6648 };

// Notch rear sight: two blades with a V gap whose bottom sits on the sight line.
function notch(P, y, u, width = 0.03, metal = 'metal') {
  const h = 0.012;
  P.push({ g: box(width * 0.42, h, 0.004, -width * 0.29, y - h / 2 + 0.004, u), mat: metal });
  P.push({ g: box(width * 0.42, h, 0.004, width * 0.29, y - h / 2 + 0.004, u), mat: metal });
  P.push({ g: box(width, 0.006, 0.004, 0, y - 0.011, u), mat: metal });
}
// Front post (top exactly on the sight line), optionally hooded.
function post(P, y, u, base, hood = false) {
  P.push({ g: box(0.0045, y - base, 0.004, 0, (y + base) / 2, u), mat: 'metal' });
  if (hood) {
    const g = new THREE.CylinderGeometry(0.013, 0.013, 0.02, 14, 1, true, -Math.PI / 2 - 1.1, Math.PI + 2.2);
    g.rotateX(Math.PI / 2); g.rotateZ(Math.PI); g.translate(0, y - 0.004, -u);
    P.push({ g, mat: 'metal' });
  } else {
    P.push({ g: box(0.003, 0.016, 0.01, -0.009, y - 0.007, u), mat: 'metal' }); // protective ears
    P.push({ g: box(0.003, 0.016, 0.01, 0.009, y - 0.007, u), mat: 'metal' });
  }
}

function garand() {
  const P = [], SL = 0.058;
  P.push({ g: profile([[-0.44, -0.118], [-0.44, 0.012], [-0.3, 0.008], [-0.14, -0.002], [-0.09, -0.012], [-0.07, -0.004], [0.08, 0.004], [0.44, 0.008], [0.46, -0.004], [0.46, -0.022], [0.12, -0.03], [0.06, -0.05], [0.0, -0.05], [-0.04, -0.06], [-0.07, -0.088], [-0.11, -0.084], [-0.16, -0.06], [-0.3, -0.085]], 0.046), mat: 'wood' });
  P.push({ g: box(0.05, 0.132, 0.007, 0, -0.053, -0.443), mat: 'park' });         // butt plate
  P.push({ g: box(0.02, 0.05, 0.002, 0, -0.06, -0.4475), mat: 'dark' });          // butt trap
  // receiver: solid heel at the back, open on top over the magazine, ring at the front
  P.push({ g: rbox(0.033, 0.034, 0.175, 0, 0.017, -0.0925), mat: 'park' });        // heel
  P.push({ g: rbox(0.033, 0.012, 0.1, 0, 0.006, 0.05), mat: 'park' });             // floor of the well
  P.push({ g: rbox(0.033, 0.034, 0.07, 0, 0.017, 0.125), mat: 'park' });           // receiver ring
  // bolt, closed: fills the top of the receiver from the heel to the chamber, over the rounds
  P.push({ g: rbox(0.025, 0.02, 0.17, 0, 0.024, 0.075, 0.008), mat: 'park' });
  P.push({ g: box(0.004, 0.008, 0.03, 0.0125, 0.03, 0.135), mat: 'park' });        // extractor (right)
  P.push({ g: tube(0.0042, 0.0042, 0.088, 0.096, 0.032, 0.014, 8), mat: 'park' });  // bolt roller
  P.push({ g: rbox(0.026, 0.008, 0.06, 0, 0.003, 0.03), mat: 'brass' });           // en-bloc clip top
  for (let k = 0; k < 2; k++) {                                                      // .30-06 rounds showing in the clip
    P.push({ g: tube(0.0058, 0.0058, 0.005, 0.07, 0.013 + k * 0.004, (k ? 0.0055 : -0.0055), 10), mat: 'brass' });
    P.push({ g: tube(0.0058, 0.002, 0.07, 0.09, 0.013 + k * 0.004, (k ? 0.0055 : -0.0055), 10), mat: 'brass' });
  }
  P.push({ g: box(0.004, 0.03, 0.1, 0.0145, 0.019, 0.04), mat: 'park' });          // magazine-well walls
  P.push({ g: box(0.004, 0.03, 0.1, -0.0145, 0.019, 0.04), mat: 'park' });
  P.push({ g: box(0.026, 0.016, 0.03, 0, 0.038, -0.045), mat: 'park' });           // rear sight base
  P.push({ g: box(0.004, 0.034, 0.012, -0.015, 0.05, -0.045), mat: 'park' });      // sight ears
  P.push({ g: box(0.004, 0.034, 0.012, 0.015, 0.05, -0.045), mat: 'park' });
  P.push({ g: ring(0.0062, 0.0017, 0, SL, -0.045), mat: 'park' });                 // aperture
  P.push({ g: box(0.004, 0.012, 0.004, 0, SL - 0.017, -0.045), mat: 'park' });
  P.push({ g: tube(0.0135, 0.011, 0.16, 0.62, 0.018, 0, 12), mat: 'park' });       // barrel
  P.push({ g: tube(0.018, 0.017, 0.17, 0.3, 0.02, 0, 12), mat: 'wood' });         // rear handguard
  P.push({ g: tube(0.0175, 0.016, 0.33, 0.5, 0.02, 0, 12), mat: 'wood' });         // front handguard
  P.push({ g: ring(0.019, 0.003, 0, 0.012, 0.31), mat: 'park' });                  // barrel band
  P.push({ g: tube(0.006, 0.006, 0.05, 0.56, 0.008, 0.02, 8), mat: 'park' });      // operating rod
  P.push({ g: tube(0.016, 0.016, 0.54, 0.64, 0.012, 0, 12), mat: 'park' });        // gas cylinder
  P.push({ g: tube(0.0125, 0.0125, 0.64, 0.655, 0.012, 0, 10), mat: 'park' });     // gas cylinder lock screw
  P.push({ g: box(0.01, 0.012, 0.03, 0, -0.008, 0.6), mat: 'park' });             // bayonet lug
  P.push({ g: ring(0.009, 0.0022, 0, -0.012, 0.57, 8).rotateY(0), mat: 'park' });  // stacking swivel
  // front sight: blade on a base, with protective ears
  P.push({ g: box(0.016, SL - 0.03, 0.016, 0, (SL + 0.03) / 2 - 0.004, 0.632), mat: 'park' });
  P.push({ g: box(0.0045, 0.012, 0.004, 0, SL - 0.006, 0.632), mat: 'park' });
  for (const sx of [-1, 1]) P.push({ g: box(0.003, 0.02, 0.014, sx * 0.011, SL - 0.008, 0.632), mat: 'park' });
  P.push({ g: ring(0.019, 0.0025, 0, 0.022, 0.165), mat: 'park' });               // rear handguard band
  // trigger housing under the receiver, with the guard loop and safety
  P.push({ g: rbox(0.03, 0.022, 0.13, 0, -0.058, 0.03, 0.005), mat: 'park' });
  const tg = new THREE.TorusGeometry(0.021, 0.0035, 6, 16, Math.PI * 1.1); tg.rotateY(Math.PI / 2); tg.rotateX(Math.PI * 0.95); tg.translate(0, -0.066, -0.01);
  P.push({ g: tg, mat: 'park' });                                                   // trigger guard (side plane)
  P.push({ g: box(0.005, 0.026, 0.006, 0, -0.072, 0.0), mat: 'park' });            // trigger
  P.push({ g: box(0.012, 0.008, 0.01, 0, -0.07, -0.042), mat: 'park' });           // safety at the front of the guard
  P.push({ g: ring(0.01, 0.002, 0, -0.038, 0.4, 8), mat: 'park' });                // sling swivel
  P.push({ g: box(0.01, 0.012, 0.03, 0.022, 0.026, 0.11), mat: 'park' });          // operating-rod handle (right side)
  P.push({ g: tube(0.0055, 0.0055, -0.05, -0.04, 0.05, -0.02, 8), mat: 'park' });  // windage knob (left)
  P.push({ g: tube(0.0055, 0.0055, -0.05, -0.04, 0.042, 0.02, 8), mat: 'park' });  // elevation knob (right)
  P.push({ g: box(0.034, 0.006, 0.05, 0, 0.0365, -0.09), mat: 'park' });           // receiver heel
  P.push({ g: box(0.004, 0.012, 0.03, -0.0175, 0.012, 0.03), mat: 'park' });       // clip latch
  P.push({ g: box(0.03, 0.004, 0.012, 0, 0.024, 0.31), mat: 'park' });             // lower band
  return { parts: P, sightY: SL, rearU: -0.045, frontU: 0.632, muzzleU: 0.66, boreY: 0.018, aperture: true,
    grip: [0, -0.05, 0.075], gripType: 'wrist', fore: [0, -0.032, -0.3], foreH: 0.068, foreW: 0.024 };
}

function kar98k() {
  const P = [], SL = 0.052;
  P.push({ g: profile([[-0.45, -0.115], [-0.45, 0.01], [-0.28, 0.005], [-0.12, -0.006], [-0.08, -0.002], [0.12, 0.004], [0.56, 0.006], [0.58, -0.004], [0.58, -0.022], [0.12, -0.03], [0.06, -0.052], [-0.0, -0.052], [-0.05, -0.058], [-0.08, -0.08], [-0.12, -0.076], [-0.18, -0.058], [-0.3, -0.082]], 0.044), mat: 'wood' });
  P.push({ g: rbox(0.03, 0.032, 0.2, 0, 0.016, 0.03), mat: 'metal' });             // receiver
  P.push({ g: tube(0.008, 0.008, -0.08, 0.06, 0.03, 0, 10), mat: 'metal' });       // bolt body
  P.push({ g: tube(0.003, 0.003, 0, 0.05, 0.03, 0.028, 6), mat: 'metal' });        // bolt handle (turned down)
  P.push({ g: new THREE.SphereGeometry(0.008, 8, 6).translate(0.05, 0.008, 0.02), mat: 'metal' });
  P.push({ g: tube(0.006, 0.006, -0.1, -0.08, 0.03, 0, 8), mat: 'metal' });        // safety
  P.push({ g: tube(0.014, 0.0095, 0.13, 0.66, 0.018, 0, 12), mat: 'metal' });      // barrel
  P.push({ g: tube(0.016, 0.0155, 0.24, 0.52, 0.022, 0, 12), mat: 'wood2' });      // upper handguard
  P.push({ g: rbox(0.022, 0.02, 0.07, 0, 0.034, -0.2), mat: 'metal' });           // tangent sight base
  notch(P, SL, 0.2, 0.026);
  P.push({ g: ring(0.022, 0.004, 0, 0.006, 0.36), mat: 'metal' });                 // barrel bands
  P.push({ g: ring(0.021, 0.005, 0, 0.004, 0.55), mat: 'metal' });
  P.push({ g: tube(0.004, 0.004, 0.55, 0.68, -0.01, 0, 6), mat: 'metal' });        // cleaning rod
  P.push({ g: box(0.012, 0.024, 0.03, 0, 0.034, -0.645), mat: 'metal' });          // front sight base
  post(P, SL, 0.65, 0.04, true);
  P.push({ g: ring(0.02, 0.003, 0, -0.047, 0.012, 12), mat: 'metal' });
  P.push({ g: box(0.004, 0.02, 0.004, 0, -0.036, 0.0), mat: 'metal' });
  return { parts: P, sightY: SL, rearU: 0.2, frontU: 0.65, muzzleU: 0.68, boreY: 0.018, aperture: false, grip: [0, -0.06, 0.08], fore: [0, -0.02, -0.33] };
}

// Thompson M1A1: plain barrel, horizontal forearm, L-shaped rear sight with protective ears
function thompson() {
  const P = [], SL = 0.074;
  P.push({ g: profile([[-0.44, -0.125], [-0.44, 0.018], [-0.12, 0.02], [-0.095, 0.004], [-0.095, -0.028], [-0.17, -0.048], [-0.33, -0.098]], 0.042), mat: 'wood' }); // buttstock
  P.push({ g: box(0.044, 0.03, 0.004, 0, -0.052, -0.44), mat: 'metal' });             // butt plate
  P.push({ g: rbox(0.05, 0.046, 0.3, 0, 0.03, 0.06, 0.008), mat: 'metal' });          // upper receiver
  P.push({ g: rbox(0.044, 0.03, 0.27, 0, -0.006, 0.05, 0.006), mat: 'metal' });       // lower frame
  P.push({ g: box(0.006, 0.012, 0.08, 0.0255, 0.04, 0.02), mat: 'dark' });            // ejection port (right)
  P.push({ g: box(0.008, 0.012, 0.014, 0.028, 0.032, 0.09), mat: 'metal' });          // cocking knob (right side)
  P.push({ g: box(0.004, 0.006, 0.12, 0.026, 0.028, 0.06), mat: 'dark' });            // cocking slot
  P.push({ g: profile([[-0.06, -0.02], [-0.018, -0.02], [-0.028, -0.12], [-0.078, -0.118]], 0.034), mat: 'wood' }); // pistol grip
  P.push({ g: ring(0.02, 0.003, 0, -0.035, 0.0, 12), mat: 'metal' });                  // trigger guard
  P.push({ g: box(0.004, 0.02, 0.004, 0, -0.028, 0.0), mat: 'metal' });                // trigger
  P.push({ g: tube(0.004, 0.004, -0.05, -0.04, -0.005, -0.024, 6), mat: 'metal' });   // selector / safety (left)
  P.push({ g: box(0.004, 0.01, 0.012, -0.024, -0.005, 0.03), mat: 'metal' });
  P.push({ g: rbox(0.026, 0.2, 0.042, 0, -0.105, 0.065, 0.004), mat: 'metal' });       // 30-round stick magazine
  P.push({ g: box(0.028, 0.012, 0.046, 0, -0.205, 0.065), mat: 'metal' });             // magazine base
  P.push({ g: tube(0.0115, 0.0105, 0.21, 0.47, 0.03, 0, 12), mat: 'metal' });          // plain barrel
  P.push({ g: tube(0.0135, 0.0135, 0.2, 0.24, 0.03, 0, 12), mat: 'metal' });           // barrel collar
  P.push({ g: profile([[0.2, 0.012], [0.37, 0.012], [0.38, 0.0], [0.37, -0.03], [0.2, -0.03]], 0.04), mat: 'wood' }); // horizontal forearm
  P.push({ g: box(0.012, 0.024, 0.01, 0, 0.045, 0.46), mat: 'metal' });               // front sight blade base
  post(P, SL, 0.46, 0.04);
  // rear sight: L-shaped flip sight with protective ears
  P.push({ g: box(0.03, 0.012, 0.03, 0, 0.059, -0.055), mat: 'metal' });
  P.push({ g: box(0.004, 0.026, 0.02, -0.014, SL - 0.002, -0.055), mat: 'metal' });
  P.push({ g: box(0.004, 0.026, 0.02, 0.014, SL - 0.002, -0.055), mat: 'metal' });
  P.push({ g: ring(0.006, 0.0017, 0, SL, -0.055), mat: 'metal' });
  P.push({ g: box(0.004, 0.012, 0.004, 0, SL - 0.012, -0.055), mat: 'metal' });
  P.push({ g: ring(0.01, 0.002, 0, -0.04, -0.3, 8), mat: 'metal' });                 // sling swivel
  return { parts: P, sightY: SL, rearU: -0.055, frontU: 0.46, muzzleU: 0.47, boreY: 0.03, aperture: true,
    grip: [0, -0.065, 0.048], gripType: 'pistol', fore: [0, -0.03, -0.29], foreH: 0.042, foreW: 0.02 };
}

function mp40() {
  const P = [], SL = 0.066;
  P.push({ g: tube(0.021, 0.021, -0.1, 0.22, 0.028, 0, 14), mat: 'metal' });       // receiver tube
  P.push({ g: rbox(0.03, 0.05, 0.12, 0, -0.005, 0.07), mat: 'dark' });             // magazine housing / lower
  P.push({ g: profile([[-0.06, -0.02], [-0.015, -0.02], [-0.028, -0.115], [-0.075, -0.115]], 0.032), mat: 'dark' }); // grip
  P.push({ g: rbox(0.026, 0.25, 0.034, 0, -0.14, 0.1, 0.004), mat: 'metal' });    // long magazine
  P.push({ g: tube(0.011, 0.011, 0.22, 0.43, 0.028, 0, 10), mat: 'metal' });       // barrel
  P.push({ g: box(0.014, 0.012, 0.05, 0, 0.01, -0.3), mat: 'dark' });              // resting bar
  P.push({ g: tube(0.004, 0.004, -0.42, -0.07, 0.02, -0.014, 6), mat: 'metal' });  // folding stock (extended)
  P.push({ g: tube(0.004, 0.004, -0.42, -0.07, 0.02, 0.014, 6), mat: 'metal' });
  P.push({ g: rbox(0.034, 0.1, 0.012, 0, -0.01, -0.43, 0.004), mat: 'metal' });    // butt plate
  P.push({ g: box(0.008, 0.008, 0.02, -0.025, 0.035, 0.05), mat: 'metal' });       // bolt handle (left)
  P.push({ g: box(0.02, 0.014, 0.02, 0, 0.052, 0.02), mat: 'metal' });             // rear sight base
  notch(P, SL, 0.02, 0.022);
  P.push({ g: box(0.01, 0.022, 0.02, 0, 0.045, -0.41), mat: 'metal' });
  post(P, SL, 0.41, 0.05, true);
  return { parts: P, sightY: SL, rearU: 0.02, frontU: 0.41, muzzleU: 0.435, boreY: 0.028, aperture: false, grip: [0, -0.06, 0.045], fore: [-0.01, -0.12, -0.1] };
}

function bar() {
  const P = [], SL = 0.074;
  P.push({ g: profile([[-0.48, -0.12], [-0.48, 0.02], [-0.2, 0.02], [-0.08, 0.0], [-0.08, -0.02], [-0.03, -0.035], [-0.03, -0.085], [-0.08, -0.08], [-0.16, -0.06], [-0.32, -0.088]], 0.046), mat: 'wood' });
  P.push({ g: rbox(0.046, 0.07, 0.38, 0, 0.018, 0.13, 0.008), mat: 'park' });      // receiver
  P.push({ g: rbox(0.042, 0.1, 0.07, 0, -0.07, 0.1, 0.004), mat: 'park' });        // 20-round box magazine
  P.push({ g: profile([[0.33, 0.008], [0.6, 0.008], [0.6, -0.024], [0.33, -0.026]], 0.044), mat: 'wood' }); // fore-end
  P.push({ g: tube(0.014, 0.012, 0.32, 0.82, 0.03, 0, 12), mat: 'park' });         // barrel
  P.push({ g: tube(0.016, 0.016, 0.82, 0.88, 0.03, 0, 12), mat: 'park' });         // flash hider
  P.push({ g: tube(0.007, 0.007, 0.5, 0.78, 0.0, 0, 8), mat: 'park' });           // gas tube
  P.push({ g: box(0.03, 0.02, 0.04, 0, 0.06, 0.0), mat: 'park' });                 // rear sight base
  P.push({ g: box(0.004, 0.026, 0.012, -0.013, SL - 0.002, 0.0), mat: 'park' });
  P.push({ g: box(0.004, 0.026, 0.012, 0.013, SL - 0.002, 0.0), mat: 'park' });
  P.push({ g: ring(0.0062, 0.0017, 0, SL, 0.0), mat: 'park' });
  post(P, SL, 0.84, 0.045);
  P.push({ g: ring(0.02, 0.003, 0, -0.045, 0.02, 12), mat: 'park' });                 // trigger guard
  P.push({ g: box(0.004, 0.02, 0.004, 0, -0.035, 0.0), mat: 'park' });                 // trigger
  P.push({ g: box(0.006, 0.016, 0.1, 0.024, 0.03, 0.15), mat: 'dark' });              // ejection port (right)
  P.push({ g: box(0.01, 0.014, 0.018, -0.026, 0.02, 0.24), mat: 'park' });            // cocking handle (left)
  P.push({ g: box(0.008, 0.008, 0.02, -0.024, -0.008, 0.02), mat: 'park' });          // selector (left)
  P.push({ g: box(0.046, 0.008, 0.06, 0, -0.019, 0.1), mat: 'park' });                // magazine well lip
  for (let k = 0; k < 5; k++) P.push({ g: box(0.046, 0.003, 0.012, 0, -0.026, 0.36 + k * 0.05), mat: 'wood2' }); // fore-end grooves
  P.push({ g: box(0.034, 0.016, 0.03, 0, 0.0, 0.76), mat: 'park' });                  // gas cylinder bracket
  P.push({ g: box(0.008, 0.03, 0.03, 0, 0.055, -0.0), mat: 'park' });                 // sight leaf
  return { parts: P, sightY: SL, rearU: 0.0, frontU: 0.84, muzzleU: 0.88, boreY: 0.03, aperture: true,
    grip: [0, -0.05, 0.075], gripType: 'wrist', fore: [0, -0.028, -0.45], foreH: 0.062, foreW: 0.025 };
}

function mg42() {
  const P = [], SL = 0.086;
  P.push({ g: profile([[-0.52, -0.11], [-0.52, 0.025], [-0.12, 0.04], [-0.08, 0.02], [-0.08, -0.01], [-0.3, -0.08]], 0.046), mat: 'dark' });
  P.push({ g: rbox(0.06, 0.08, 0.42, 0, 0.022, 0.13, 0.01), mat: 'metal' });       // receiver + top cover
  P.push({ g: profile([[-0.07, -0.016], [-0.025, -0.016], [-0.035, -0.115], [-0.08, -0.115]], 0.034), mat: 'dark' });
  P.push({ g: tube(0.029, 0.029, 0.34, 0.8, 0.032, 0, 14), mat: 'metal' });        // barrel jacket
  for (let k = 0; k < 7; k++) { // cooling slots
    P.push({ g: rbox(0.06, 0.012, 0.04, 0, 0.032, 0.38 + k * 0.058, 0.005), mat: 'dark' });
  }
  P.push({ g: tube(0.018, 0.022, 0.8, 0.88, 0.032, 0, 12), mat: 'metal' });        // muzzle booster
  P.push({ g: rbox(0.034, 0.016, 0.06, 0, 0.069, 0.12, 0.004), mat: 'metal' });    // tangent sight base
  notch(P, SL, 0.12, 0.03);
  P.push({ g: box(0.008, SL - 0.06, 0.008, 0, (SL + 0.06) / 2, -0.72), mat: 'metal' }); // folding front post
  P.push({ g: box(0.02, 0.004, 0.012, 0, 0.061, -0.72), mat: 'metal' });
  P.push({ g: rbox(0.09, 0.09, 0.09, -0.075, -0.01, 0.12, 0.02), mat: 'canvas' }); // belt drum
  P.push({ g: box(0.05, 0.012, 0.06, -0.035, 0.03, 0.12), mat: 'brass' });           // belt
  P.push({ g: tube(0.005, 0.005, 0.55, 0.78, -0.002, -0.02, 6), mat: 'metal' });   // bipod
  P.push({ g: tube(0.005, 0.005, 0.55, 0.78, -0.002, 0.02, 6), mat: 'metal' });
  return { parts: P, sightY: SL, rearU: 0.12, frontU: 0.72, muzzleU: 0.88, boreY: 0.032, aperture: false, grip: [0, -0.07, 0.05], fore: [-0.04, -0.06, -0.18] };
}

function springfield() {
  const P = [], SL = 0.085;
  P.push({ g: profile([[-0.44, -0.115], [-0.44, 0.012], [-0.28, 0.008], [-0.12, -0.004], [-0.08, 0.0], [0.12, 0.004], [0.5, 0.006], [0.52, -0.004], [0.52, -0.022], [0.12, -0.03], [0.06, -0.05], [0.0, -0.05], [-0.05, -0.058], [-0.08, -0.08], [-0.12, -0.076], [-0.18, -0.058], [-0.3, -0.082]], 0.044), mat: 'wood' });
  P.push({ g: rbox(0.03, 0.03, 0.2, 0, 0.016, 0.03), mat: 'park' });
  P.push({ g: tube(0.008, 0.008, -0.08, 0.06, 0.03, 0, 10), mat: 'park' });
  P.push({ g: tube(0.003, 0.003, 0, 0.05, 0.03, 0.028, 6), mat: 'park' });
  P.push({ g: new THREE.SphereGeometry(0.008, 8, 6).translate(0.05, 0.03, -0.0), mat: 'park' });
  P.push({ g: tube(0.013, 0.0095, 0.13, 0.62, 0.018, 0, 12), mat: 'park' });
  P.push({ g: tube(0.016, 0.0155, 0.2, 0.46, 0.022, 0, 12), mat: 'wood' });
  // Weaver 330 telescope on mounts
  P.push({ g: tube(0.016, 0.016, -0.12, -0.06, SL, 0, 16), mat: 'metal' });   // eyepiece bell
  P.push({ g: tube(0.011, 0.011, -0.06, 0.16, SL, 0, 14), mat: 'metal' });    // tube
  P.push({ g: tube(0.015, 0.015, 0.16, 0.22, SL, 0, 16), mat: 'metal' });     // objective bell
  P.push({ g: box(0.012, SL - 0.03, 0.012, 0, (SL + 0.03) / 2, -0.03), mat: 'metal' });
  P.push({ g: box(0.012, SL - 0.03, 0.012, 0, (SL + 0.03) / 2, 0.1), mat: 'metal' });
  P.push({ g: ring(0.02, 0.003, 0, -0.046, 0.012, 12), mat: 'park' });
  return { parts: P, sightY: SL, rearU: -0.12, frontU: 0.22, muzzleU: 0.62, boreY: 0.018, aperture: true, scope: true, grip: [0, -0.06, 0.08], fore: [0, -0.02, -0.3] };
}
function bazooka() {
  const P = [], SL = 0.085;
  P.push({ g: tube(0.037, 0.037, -0.7, 0.86, 0.03, 0, 18), mat: 'park' });              // launch tube
  P.push({ g: tube(0.045, 0.04, 0.82, 0.92, 0.03, 0, 18), mat: 'park' });              // flared muzzle
  P.push({ g: tube(0.042, 0.042, -0.74, -0.68, 0.03, 0, 18), mat: 'park' });           // rear ring
  P.push({ g: rbox(0.03, 0.05, 0.22, 0, -0.04, -0.3, 0.008), mat: 'wood' });            // shoulder stock
  P.push({ g: profile([[-0.03, -0.01], [0.01, -0.01], [0.0, -0.11], [-0.04, -0.11]], 0.032), mat: 'wood' }); // grip
  P.push({ g: profile([[0.28, -0.01], [0.32, -0.01], [0.31, -0.1], [0.27, -0.1]], 0.032), mat: 'wood' });   // fore grip
  P.push({ g: rbox(0.05, 0.03, 0.08, 0, -0.035, 0.1, 0.006), mat: 'dark' });            // battery box
  P.push({ g: box(0.004, SL - 0.06, 0.004, 0, (SL + 0.06) / 2, -0.25), mat: 'metal' }); // rear sight post
  P.push({ g: ring(0.006, 0.0017, 0, SL, -0.25), mat: 'metal' });
  P.push({ g: box(0.03, 0.004, 0.004, 0, SL + 0.012, 0.55), mat: 'metal' });            // front sight frame
  P.push({ g: box(0.004, 0.026, 0.004, -0.015, SL, 0.55), mat: 'metal' });
  P.push({ g: box(0.004, 0.026, 0.004, 0.015, SL, 0.55), mat: 'metal' });
  P.push({ g: box(0.0045, 0.012, 0.004, 0, SL - 0.006, 0.55), mat: 'metal' });
  return { parts: P, sightY: SL, rearU: -0.25, frontU: 0.55, muzzleU: 0.92, boreY: 0.03, aperture: true, grip: [0, -0.06, 0.0], fore: [0, -0.06, -0.3] };
}

const BUILD = { allies: { rifleman: garand, assault: thompson, support: bar, sniper: springfield, bazooka }, axis: { rifleman: kar98k, assault: mp40, support: mg42, sniper: kar98k, bazooka: kar98k } };
const cache = {};
// Returns { parts:[{g, mat}], sightY, rearU, frontU, muzzleU, boreY, aperture, grip, fore }
export function buildGun(team, cls) {
  const k = team + cls;
  if (!cache[k]) cache[k] = BUILD[team][cls]();
  return cache[k];
}
export const GUN_COLORS = C;
