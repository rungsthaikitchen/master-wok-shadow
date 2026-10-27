// Public application identifiers only. No data adapter or enabled deployment.
import {createAccessAdminGate,PROJECT} from './access-gate.mjs';
export const PREVIEW_ACCESS=Object.freeze({
 project:PROJECT,
 teamDomain:'https://rungsthaikitchen.cloudflareaccess.com',
 audience:'3b86da1957ccfaeb4cc0ac32d737d93841f97bb9919c34237dbb291a4f4ef8a2',
 requestOrigin:'https://preview-staff-browser-2026-1.rungsthaikitchen.pages.dev'
});
// Pin the application and hostname after options, so callers cannot override them.
// Existing browser API remains synthetic-only and disabled in deployed bundles.
export function createPreviewAccessGate(options={}){
 return createAccessAdminGate({...options,...PREVIEW_ACCESS});
}
