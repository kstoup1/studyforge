// 4MB, not the 15MB docs/PLAN.md §6 originally planned: Vercel rejects any
// serverless function request body over 4.5MB before the route handler even runs
// (with a non-JSON 413 page), so a bigger limit could never actually be reached in
// production. Shared so the upload form can reject big files before sending them.
export const MAX_UPLOAD_BYTES = 4 * 1024 * 1024;
export const MAX_UPLOAD_LABEL = "4MB";
