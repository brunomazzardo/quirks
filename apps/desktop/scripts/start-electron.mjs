// Production launch out of the workspace: opens the built main bundle against
// the built renderer in apps/web/dist, with no dev server involved.
//
// Mirrored from t3code's apps/desktop/scripts/start-electron.mjs; the spawn and
// exit-forwarding now live in electron-launcher.mjs so dev and start cannot
// drift on how they clean up.

import { runElectron } from "./electron-launcher.mjs";

runElectron();
