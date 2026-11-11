// M16: no key in the production bundle.   node e2e/m16_bundle_scan.mjs   (after `npm run build`)
// Reads the VALUES of every variable in backend/.env (never printing them) and looks for each one, and for key-shaped strings, in every file under dist/.
import fs from "node:fs";
import path from "node:path";

const dist = path.resolve("dist");
const envFile = path.resolve("..", "backend", ".env");
const secrets = [];
if (fs.existsSync(envFile)) {
  for (const line of fs.readFileSync(envFile, "utf8").split(/\r?\n/)) {
    const m = line.match(/^([A-Z][A-Z0-9_]+)=(.*)$/);
    if (m && m[2].trim().length >= 6) secrets.push([m[1], m[2].trim()]);
  }
}
const files = [];
function walk(d) { for (const e of fs.readdirSync(d, { withFileTypes: true })) { const p = path.join(d, e.name); if (e.isDirectory()) walk(p); else files.push(p); } }
walk(dist);
let bad = 0;
const check = (name, ok, extra = "") => { if (!ok) bad++; console.log(`${ok ? "PASS" : "FAIL"}  ${name} ${extra}`); };

const textFiles = files.filter((f) => /\.(js|css|html|json|svg|map|txt)$/i.test(f));
const blob = textFiles.map((f) => [f, fs.readFileSync(f, "utf8")]);
console.log(`scanned ${blob.length} text files (${files.length} files, ${(files.reduce((n, f) => n + fs.statSync(f).size, 0) / 1e6).toFixed(1)} MB) against ${secrets.length} secret values from backend/.env`);
for (const [name, val] of secrets) check(`the value of ${name} is not in the bundle`, !blob.some(([, t]) => t.includes(val)));
const patterns = [["sk-ant-", /sk-ant-[A-Za-z0-9_-]{10,}/], ["ghp_ token", /ghp_[A-Za-z0-9]{20,}/], ["AWS access key id", /AKIA[0-9A-Z]{16}/], ["?key= / &api_key= with a value", /[?&](?:api_)?key=[A-Za-z0-9_-]{8,}/i]];
for (const [label, re] of patterns) check(`no ${label} in the bundle`, !blob.some(([, t]) => re.test(t)));
const hex = blob.flatMap(([f, t]) => (t.match(/\b(?=[a-f0-9]*[a-f])(?=[a-f0-9]*\d)[a-f0-9]{32,}\b/gi) ?? []).map((m) => [path.basename(f), m.length]));
check("no 32+ character hex token mixing letters and digits (a run of digits only, such as a maths constant, is not a token)", hex.length === 0, hex.length ? `(${hex.length} found, in ${[...new Set(hex.map((h) => h[0]))].join(", ")})` : "");
check("the API origin in the bundle is the public address only", blob.some(([, t]) => t.includes((process.env.API_ORIGIN_EXPECT ?? "http://127.0.0.1:8002"))) && !blob.some(([, t]) => /api\.eia\.gov|newsapi\.org|elaneglobal|api\.anthropic\.com|aisstream\.io|alphavantage\.co/i.test(t)));
console.log(bad ? `\n${bad} FAILED` : "\nall clear");
process.exit(bad ? 1 : 0);
