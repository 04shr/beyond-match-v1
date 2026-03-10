import { analytics, auth, db } from "./auth.js";

import { logEvent } 
from "https://www.gstatic.com/firebasejs/10.7.1/firebase-analytics.js";

import { onAuthStateChanged } 
from "https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js";

import {
  collection,
  getDocs,
  addDoc,
  query,
  where,
  doc,
  getDoc,
  updateDoc,      // ✅ FIX ADDED
  serverTimestamp
} from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";


const API_BASE = "https://2bcj60lax1.execute-api.eu-north-1.amazonaws.com/prod";

import { callGemini } from "./gemini.js";

/* =========================================================
   LLM ENRICHMENT — RECRUITER SIDE
   Generates recruiter summary + shortlist flags per candidate
========================================================= */
// Cache: job_id → enriched LLM results array
const llmCandidateCache = {};

async function enrichCandidatesWithLLM(matches, cacheKey) {

  // Return cached result if same job was already enriched
  if (cacheKey && llmCandidateCache[cacheKey]) {
    console.log("LLM candidate cache hit:", cacheKey);
    return llmCandidateCache[cacheKey];
  }

  const slim = matches.map(m => ({
    candidate_id: m.candidate_id,
    name: m.name || "Unknown",
    match_percent: m.match_percent,
    confidence: m.confidence || "N/A",
    top_reason: m.explanation?.top_reason || ""
  }));

  const prompt = `You are a recruitment AI assistant.
For each candidate below, write a 1-sentence recruiter note (max 20 words) on their suitability,
and set shortlist_flag true for the top 2 you'd recommend interviewing first.

IMPORTANT: Return ONLY a raw JSON array. No markdown, no backticks. Just the JSON.
[{ "candidate_id": "...", "recruiter_summary": "...", "shortlist_flag": true/false }]

Candidates:
${JSON.stringify(slim, null, 2)}`;

  try {
    const raw = await callGemini(prompt);
    if (!raw) return matches.map(m => ({ candidate_id: m.candidate_id, recruiter_summary: null, shortlist_flag: false }));
    const clean = raw.replace(/```json|```/g, "").trim();
    const result = JSON.parse(clean);
    if (cacheKey) llmCandidateCache[cacheKey] = result;
    return result;
  } catch (err) {
    console.warn("Recruiter LLM enrichment failed:", err);
    return matches.map(m => ({ candidate_id: m.candidate_id, recruiter_summary: null, shortlist_flag: false }));
  }
}

export { apiFetch };


let selectedJobIdForCandidates = null;
export function normalizeApiResponse(res) {
  if (!res) return [];

  // If backend returned array directly
  if (Array.isArray(res)) return res;

  // If backend wrapped data inside body string
  if (res.body && typeof res.body === "string") {
    try {
      const parsed = JSON.parse(res.body);

      if (Array.isArray(parsed)) return parsed;
      if (parsed.matches) return parsed.matches;

      return [];
    } catch {
      return [];
    }
  }

  // If backend returned object with matches key
  if (res.matches) return res.matches;

  return [];
}
/* =========================================================
   GENERIC API FETCH
========================================================= */
async function apiFetch(path, options = {}) {

  const res = await fetch(`${API_BASE}${path}`, {
    headers: { "Content-Type": "application/json" },
    ...options
  });

  if (!res.ok) {
    console.error("API error:", res.status, path);
    return {};
  }

  const text = await res.text();
  if (!text) return {};
  
  const data = JSON.parse(text);
  
  // Handle AWS Lambda response format: {statusCode, headers, body: "..."}
  if (data.statusCode && data.body && typeof data.body === 'string') {
    try {
      return JSON.parse(data.body);
    } catch (e) {
      console.warn("Could not parse body:", e.message);
      return data.body;
    }
  }
  
  return data;
}
window.apiFetch = apiFetch;

async function fetchJobs() {
  const res = await apiFetch("/jobs");
  return normalizeApiResponse(res);
}


window.fetchJobs = fetchJobs;
/* =========================================================
   SKELETON LOADERS
========================================================= */
function showJobsSkeletonLoader(container, count = 5) {
  container.innerHTML = Array.from({ length: count }).map(() => `
    <div class="job-card skeleton-card" aria-hidden="true">
      <div class="skeleton skeleton-title"></div>
      <div class="skeleton skeleton-line"></div>
      <div class="skeleton skeleton-line short"></div>
      <div class="skeleton skeleton-line"></div>
      <div class="skeleton skeleton-btn"></div>
    </div>
  `).join("");
}

function showCandidatesSkeletonLoader(container, count = 4) {
  container.innerHTML = Array.from({ length: count }).map(() => `
    <div class="cand-card skeleton-card" aria-hidden="true">
      <div class="skeleton skeleton-title"></div>
      <div class="skeleton skeleton-line"></div>
      <div class="skeleton skeleton-line short"></div>
      <div class="skeleton skeleton-btn"></div>
    </div>
  `).join("");
}

async function renderJobs() {
  const grid = document.getElementById("jobsGrid");
  if (!grid) return;

  showJobsSkeletonLoader(grid, 5);

 const res = await apiFetch("/jobs");
const jobs = normalizeApiResponse(res);


  if (!jobs.length) {
    grid.innerHTML = "No jobs available.";
    return;
  }

  grid.innerHTML = jobs.map(job => `
    <div class="job-card">
      <h3>${job.title || "Job Title"}</h3>
      <p class="company">${job.company || "Company not available"}</p>
      <p class="location">📍 ${job.location_display || "Location not specified"}</p>
      <p class="salary">
        💰 ${job.salary_min ? `₹${job.salary_min} - ₹${job.salary_max}` : "Salary not disclosed"}
      </p>
      <p class="summary">
        ${(job.description || "").slice(0, 140)}…
      </p>
      <small>Job ID: ${job.job_id}</small>
    </div>
  `).join("");
}
let selectedJobId = null;

async function populateJobDropdown() {
  const customSelect = document.getElementById("customJobSelect");
  const optionsContainer = document.getElementById("customJobOptions");
  if (!customSelect || !optionsContainer) return;

  const res = await apiFetch("/jobs");
const jobs = normalizeApiResponse(res);

  optionsContainer.innerHTML = "";

  jobs.forEach(job => {
    const option = document.createElement("div");
    option.className = "custom-option";
    option.dataset.value = job.job_id;
    option.textContent = `${job.title} — ${job.company || ""}`;
    option.onclick = () => selectJob(job.job_id, option.textContent);
    optionsContainer.appendChild(option);
  });
}

function selectJob(jobId, text) {
  selectedJobId = jobId;

  const customSelect = document.getElementById("customJobSelect");
  const triggerText = customSelect.querySelector(".custom-select-trigger span");

  // Update selected text
  triggerText.textContent = text;

  // Close dropdown
  customSelect.classList.remove("open");

  // 🔥 AUTO LOAD MATCHES
  loadMatches();
}

async function loadMatches() {
  if (!selectedJobId) {
    alert("Please select a job");
    return;
  }

  const res = await apiFetch(`/matches?job_id=${selectedJobId}&top_n=5&offset=0`);
  const data = typeof res === "string" ? JSON.parse(res) : (res.body ? JSON.parse(res.body) : res);

  const grid = document.getElementById("matchesGrid");
  grid.innerHTML = "";

  if (!data.matches || data.matches.length === 0) {
    grid.innerHTML = `
      <div class="no-matches">
        No candidates matched this job
      </div>
    `;
    return;
  }

  if (data.matches && data.matches.length > 0) {
    logEvent(analytics, "match_generated", {
      job_id: selectedJobId,
      match_count: data.matches.length
    });
  }

  showCandidatesSkeletonLoader(grid, 3);
  const llmResults = await enrichCandidatesWithLLM(data.matches, selectedJobId);
  const llmMap = {};
  llmResults.forEach(s => { llmMap[s.candidate_id] = s; });

  grid.innerHTML = "";
  data.matches.forEach(match => {
    const name = match.name || "Candidate Name Not Available";
    const email = match.email || "Email not available";
    const percent = match.match_percent != null ? match.match_percent.toFixed(1) : "0.0";
    const confidence = match.confidence || "N/A";
    const reason = match.explanation?.top_reason || "No explanation provided";
    const llm = llmMap[match.candidate_id] || {};

    grid.innerHTML += `
      <div class="match-card ${llm.shortlist_flag ? "ai-shortlist" : ""}">
        ${llm.shortlist_flag ? `<div class="ai-top-badge">⭐ AI Recommended</div>` : ""}
        <h3>${name}</h3>
        <p><strong>Email:</strong> ${email}</p>
        <p><strong>Match:</strong> ${percent}%</p>
        <p><strong>Confidence:</strong> ${confidence}</p>
        <p class="reason">${reason}</p>
        ${llm.recruiter_summary ? `<p class="ai-insight">🤖 ${llm.recruiter_summary}</p>` : ""}
      </div>
    `;
  });
}

let cachedJobs = null;

async function getStableJobs() {
  if (!cachedJobs) {
    cachedJobs = await fetchJobs();
  }
  return cachedJobs;
}

async function loadDashboardKPIs() {
  // Guard — don't run if KPI elements aren't on this page
  if (!document.getElementById("kpi-jds")) return;

  const jobs = await getStableJobs();

  // Just show job count immediately — no per-job match calls
  document.getElementById("kpi-jds").textContent = jobs.length;

  // Use a single matches call with a high top_n instead of looping every job
  if (jobs.length > 0) {
    const res = await apiFetch(`/matches?job_id=${jobs[0].job_id}&top_n=50&offset=0`);
    const data = res.body ? JSON.parse(res.body) : res;
    const matches = data.matches || [];

    document.getElementById("kpi-matches").textContent = matches.length;

    const scores = matches.map(m => m.score).filter(s => s != null);
    document.getElementById("kpi-accuracy").textContent =
      scores.length ? `${Math.round((scores.reduce((a,b) => a+b,0) / scores.length) * 100)}%` : "N/A";
  }
}
document.addEventListener("DOMContentLoaded", async () => {
  if (document.getElementById("jobsGrid")) {
    renderJobs();
  }

if (document.getElementById("customJobSelect")) {
  await populateJobDropdown();
  setupCustomDropdown();   // 🔥 MISSING LINE
  document
    .getElementById("loadMatchesBtn")
    ?.addEventListener("click", loadMatches);
}

});


function renderTopRoles(roleMap) {
  const list = document.getElementById("topRolesList");
  if (!list) return;

  const sorted = Object.entries(roleMap)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 4);

  list.innerHTML = sorted
    .map(([role, count]) => `
      <li>${role} <span>${count} matches</span></li>
    `)
    .join("");
}

function setupCustomDropdown() {
  const customSelect = document.getElementById("customJobSelect");
  const trigger = customSelect.querySelector(".custom-select-trigger");
  
  // Toggle dropdown
  trigger.addEventListener("click", (e) => {
    e.stopPropagation();
    customSelect.classList.toggle("open");
  });

  // Close dropdown when clicking outside
  document.addEventListener("click", (e) => {
    if (!customSelect.contains(e.target)) {
      customSelect.classList.remove("open");
    }
  });
}

/* =========================================================
   RECRUITER JOBS PAGE LOGIC (rec-jobs.html)
========================================================= */

let recruiterOrg = null;
let allJobs = [];
let showAll = false;

async function initRecruiterJobsPage() {

  const titleEl = document.getElementById("jobsPageTitle");
  const tableEl = document.getElementById("jobsTable");

  if (!titleEl || !tableEl) return; // Not this page
  onAuthStateChanged(auth, async (user) => {
  if (!user) {
    titleEl.textContent = "Not authenticated";
    return;
  }

  const snap = await getDoc(doc(db, "users", user.uid));

  if (!snap.exists()) {
    titleEl.textContent = "Recruiter record not found";
    return;
  }

  recruiterOrg = snap.data().organisation_name;

  if (!recruiterOrg) {
    titleEl.textContent = "No organisation linked";
    return;
  }

  titleEl.textContent = recruiterOrg + " Jobs";

  await loadRecruiterJobs();
});



document.getElementById("myOrgBtn")?.addEventListener("click", () => {
  showAll = false;
  document.getElementById("myOrgBtn").classList.add("active");
  document.getElementById("allJobsBtn").classList.remove("active");
  renderRecruiterJobs();
});

document.getElementById("allJobsBtn")?.addEventListener("click", () => {
  showAll = true;
  document.getElementById("allJobsBtn").classList.add("active");
  document.getElementById("myOrgBtn").classList.remove("active");
  renderRecruiterJobs();
});
document.getElementById("locationFilter")
  ?.addEventListener("change", renderRecruiterJobs);
  document.getElementById("searchInput")
    ?.addEventListener("input", renderRecruiterJobs);

  document.getElementById("sortSelect")
    ?.addEventListener("change", renderRecruiterJobs);
}

async function loadRecruiterJobs() {
const jobs = await getStableJobs();

// Store ALL jobs globally
allJobs = jobs;

// Filter org jobs for "My Organisation" tab
const orgJobs = jobs.filter(j =>
  j.company &&
  recruiterOrg &&
  j.company.toLowerCase().includes(
  recruiterOrg.toLowerCase().trim()
)
);

console.log("Total jobs:", jobs.length);
console.log("Org jobs:", orgJobs.length);
console.log("Organisation:", recruiterOrg);

// Initially show org jobs if available, otherwise show all
if (orgJobs.length > 0 && !showAll) {
  allJobs = orgJobs;
}

  renderRecruiterJobs();
  populateLocationFilter();
}

function formatSalary(job) {
  const min = job.salary_min;
  const max = job.salary_max;

  if (!min && !max) return "Salary not disclosed";

  if (min && max) {
    if (min === max) return `$${Math.round(min).toLocaleString()}`;
    return `$${Math.round(min).toLocaleString()} - $${Math.round(max).toLocaleString()}`;
  }

  if (min) return `From $${Math.round(min).toLocaleString()}`;
  if (max) return `Up to $${Math.round(max).toLocaleString()}`;

  return "Salary not disclosed";
}

function renderRecruiterJobs() {

  const tableEl = document.getElementById("jobsTable");
  if (!tableEl) return;

  // Show skeleton loaders while processing
  showJobsSkeletonLoader(tableEl, 5);

// Get all jobs from API
const allJobsFromAPI = cachedJobs || [];

// Filter based on showAll flag
let filtered = showAll
  ? allJobsFromAPI  // Show ALL jobs
  : allJobsFromAPI.filter(j =>  // Show only org jobs
      j.company &&
      recruiterOrg &&
    j.company.toLowerCase().includes(
  recruiterOrg.toLowerCase().trim()
)
    );

console.log("Showing:", showAll ? "ALL JOBS" : "ORG JOBS ONLY");
console.log("Filtered count:", filtered.length);

/* SEARCH */
const searchTerm =
  document.getElementById("searchInput")?.value.toLowerCase() || "";

if (searchTerm) {
  filtered = filtered.filter(j =>
    j.title?.toLowerCase().includes(searchTerm)
  );
}

/* LOCATION */
const location =
  document.getElementById("locationFilter")?.value?.toLowerCase().trim();

if (location) {
  filtered = filtered.filter(j =>
    (getJobLocation(j) || "")
      .toLowerCase()
      .trim()
      .includes(location)
  );
}
/* SORT */
const sortValue = document.getElementById("sortSelect")?.value;

if (sortValue === "title") {
  filtered.sort((a, b) => a.title.localeCompare(b.title));
}
  if (!filtered.length) {
    tableEl.innerHTML = "<p>No jobs found.</p>";
    return;
  }

  tableEl.innerHTML = filtered.map(job => `
  <div class="job-modern-card">
    <div class="job-modern-header">
      <h3>${job.title}</h3>
      <span class="job-pill">
${
  job.location_display ||
  job.location ||
  (job.city && job.country
    ? `${job.city}, ${job.country}`
    : job.country || "-")
}
</span>
    </div>

    <div class="job-modern-company">
      ${job.company || "-"}
    </div>

    <div class="job-modern-salary">
  ${formatSalary(job)}
</div>

    <div class="job-modern-actions">
      <button class="modern-view-btn"
        data-url="${job.apply_link || job.apply_url || ''}">
        View
      </button>
    </div>
  </div>
`).join("");

tableEl.querySelectorAll("button[data-url]").forEach(btn => {
  btn.addEventListener("click", () => {
    const url = btn.getAttribute("data-url");

    if (!url) {
      alert("No job link available");
      return;
    }

    window.open(url, "_blank", "noopener,noreferrer");
  });
});
}

function getJobLocation(job) {
  return (
    job.location_display ||
    job.location ||
    (job.city && job.country
      ? `${job.city}, ${job.country}`
      : job.country || null)
  );
}

function populateLocationFilter() {
  const select = document.getElementById("locationFilter");
  if (!select) return;

  const locations = [
    ...new Set(
      allJobs
        .map(getJobLocation)
        .filter(Boolean)
    )
  ];

  select.innerHTML = `
    <option value="">All Locations</option>
    ${locations.map(loc =>
      `<option value="${loc}">${loc}</option>`
    ).join("")}
  `;
}

document.addEventListener("DOMContentLoaded", initRecruiterJobsPage);

/* =========================================================
   CANDIDATE MATCHES PAGE (AUTO ORG + AUTO ROLE SELECT)
========================================================= */

let allCandidates = [];
let recruiterOrgRoleList = [];

async function initCandidateMatchesPage() {

  const container = document.getElementById("candMatchesTable");
  const roleDropdown = document.getElementById("roleDropdown");
  

  if (!container || !roleDropdown) return;

  onAuthStateChanged(auth, async (user) => {

    if (!user) {
      container.innerHTML = "User not authenticated.";
      return;
    }

    const snap = await getDoc(doc(db, "users", user.uid));

    if (!snap.exists()) {
      container.innerHTML = "User record not found.";
      return;
    }

    recruiterOrg = snap.data().organisation_name;

    if (!recruiterOrg) {
      container.innerHTML = "No organisation linked to this recruiter.";
      return;
    }

    const jobs = await getStableJobs();

    const orgJobs = jobs.filter(j =>
    j.company &&
j.company.toLowerCase().includes(
  recruiterOrg.toLowerCase().trim()
)
    );

    recruiterOrgRoleList = [
      ...new Set(orgJobs.map(j => j.title).filter(Boolean))
    ];

    if (!recruiterOrgRoleList.length) {
      container.innerHTML = "No jobs found for your organisation.";
      return;
    }

    roleDropdown.innerHTML = recruiterOrgRoleList
      .map(role => `<option value="${role}">${role}</option>`)
      .join("");


    const defaultRole = recruiterOrgRoleList[0];
    roleDropdown.value = defaultRole;


    await loadCandidatesForRole(defaultRole);

    roleDropdown.addEventListener("change", async () => {
   
      await loadCandidatesForRole(roleDropdown.value);
    });

    
// 🔥 SEARCH LISTENER
document
  .getElementById("candSearchInput")
  ?.addEventListener("input", renderCandidateMatches);

// 🔥 SORT LISTENER
document
  .getElementById("candSortSelect")
  ?.addEventListener("change", renderCandidateMatches);
  });

}

async function loadCandidatesForRole(role) {

  const container = document.getElementById("candMatchesTable");
  if (!container) return;

  showCandidatesSkeletonLoader(container, 5);

  const jobs = await getStableJobs();

 const selectedJob = jobs.find(j =>
  j.title?.toLowerCase().trim() === role.toLowerCase().trim() &&
  j.company?.toLowerCase().includes(
    recruiterOrg.toLowerCase().trim()
  )
);

  if (!selectedJob) {
    container.innerHTML = "No job found for this role.";
    return;
  }
selectedJobIdForCandidates = selectedJob.job_id;
  const res = await apiFetch(
    `/matches?job_id=${selectedJob.job_id}&top_n=50&offset=0`
  );
const data = normalizeApiResponse(res);

if (!data.length) {
  container.innerHTML = "No matching candidates found.";
  return;
}

// 🔥 Enrich candidates with Firestore data
const enriched = [];

for (const match of data) {
  const snap = await getDoc(doc(db, "candidates", match.candidate_id));
  const candidateData = snap.exists() ? snap.data() : {};

  enriched.push({
    ...match,
    name: candidateData.name || "",
    email: candidateData.email || ""
  });
}

allCandidates = enriched;
renderCandidateMatches();
}

async function renderCandidateMatches() {

  const container = document.getElementById("candMatchesTable");
  if (!container) return;

  let filtered = [...allCandidates];

  const search = document.getElementById("candSearchInput")?.value.toLowerCase() || "";
  if (search) {
    filtered = filtered.filter(c =>
      c.name?.toLowerCase().includes(search) ||
      c.email?.toLowerCase().includes(search)
    );
  }

  const sortValue = document.getElementById("candSortSelect")?.value;
  if (sortValue === "name") {
    filtered.sort((a, b) => (a.name || "").localeCompare(b.name || ""));
  }
  if (sortValue === "newest") {
    filtered.sort((a, b) => new Date(b.created_at || 0) - new Date(a.created_at || 0));
  }
  if (sortValue === "oldest") {
    filtered.sort((a, b) => new Date(a.created_at || 0) - new Date(b.created_at || 0));
  }

  if (!filtered.length) {
    container.innerHTML = "No matching candidates found.";
    return;
  }

  // Show skeleton while LLM runs (skipped if cache hit — will be instant)
  showCandidatesSkeletonLoader(container, filtered.length);

  // 🤖 LLM enrichment — cached by selectedJobIdForCandidates so switching
  // back to a role you already viewed never calls Groq again
  const llmResults = await enrichCandidatesWithLLM(filtered, selectedJobIdForCandidates);
  const llmMap = {};
  llmResults.forEach(r => { llmMap[r.candidate_id] = r; });

  const cards = filtered.map((match) => {

    const percent = match.match_percent != null ? match.match_percent.toFixed(1) : "0";

    const skills =
      match.explanation?.skill_overlap ||
      match.explanation?.top_skills ||
      match.skills ||
      (
        match.explanation?.top_reason
          ? match.explanation.top_reason
              .replace("Strong match in:", "")
              .split(",")
              .map(s => s.trim())
          : []
      );

    const llm = llmMap[match.candidate_id] || {};

    return `
      <div class="cand-card ${llm.shortlist_flag ? "ai-shortlist" : ""}">

        ${llm.shortlist_flag ? `<div class="ai-top-badge">⭐ AI Recommended</div>` : ""}

        <div class="cand-title">${match.name || "Candidate"}</div>
        <div class="cand-email">${match.email || "-"}</div>

        <div class="cand-skills">
          ${
            skills.length
              ? skills.slice(0, 3).map(s => `<span class="skill-pill">${s}</span>`).join("")
              : `<span class="skill-pill subtle">No skills available</span>`
          }
        </div>

        <div class="cand-score">
          <span class="match-pill">${percent}% Match</span>
        </div>

        <div class="cand-confidence">${match.confidence || "N/A"}</div>

        ${llm.recruiter_summary
          ? `<div class="ai-insight">🤖 ${llm.recruiter_summary}</div>`
          : ""}

        <div class="cand-actions">
          <a href="rec-actions.html?id=${match.candidate_id}&job=${selectedJobIdForCandidates}"
             class="view-btn">View</a>
        </div>

      </div>
    `;
  });

  container.innerHTML = cards.join("");
}

document.addEventListener("DOMContentLoaded", initCandidateMatchesPage);

/* =========================================================
   RECRUITER ACTIONS PAGE LOGIC
========================================================= */

async function initRecruiterActionsPage() {

  const container = document.getElementById("actionsContainer");
  if (!container) return;

  const urlParams = new URLSearchParams(window.location.search);
  const candidateId = urlParams.get("id");
  const jobId = urlParams.get("job");

  // If no candidateId, show contacted profiles list
  if (!candidateId) {
    showCandidatesSkeletonLoader(container, 4);

    const q = query(collection(db, "recruiter_actions"));
    const snap = await getDocs(q);

    if (snap.empty) {
      container.innerHTML = "No contacted candidates yet.";
      return;
    }

    const cards = [];

    for (const docSnap of snap.docs) {
      const data = docSnap.data();

      const candSnap = await getDoc(doc(db, "candidates", data.candidate_id));
      const candidate = candSnap.exists() ? candSnap.data() : {};

      function formatStatus(status = "") {
        return status
          .replace(/_/g, " ")
          .replace(/\b\w/g, l => l.toUpperCase());
      }

      cards.push(`
        <div class="cand-card action-card">

          <div class="action-header">
            <div class="action-name">
              ${candidate.name || "Candidate"}
            </div>

            <span class="action-status ${data.status}">
              ${formatStatus(data.status)}
            </span>
          </div>

          <div class="action-footer">
            <a href="rec-actions.html?id=${data.candidate_id}&job=${data.job_id}" 
               class="view-btn">
               View
            </a>
          </div>

        </div>
      `);
    }

    container.innerHTML = cards.join("");
    return;
  }

  // If candidateId exists, show candidate profile
  const snap = await getDoc(doc(db, "candidates", candidateId));
  const candidate = snap.exists() ? snap.data() : {};

  container.innerHTML = `
    <div class="profile-wrapper">

      <div class="profile-left card">

        <h2 class="section-title">Candidate Overview</h2>

        <div class="profile-info">
          <div class="info-row">
            <span class="label">Name</span>
            <span class="value">${candidate.name || "-"}</span>
          </div>

          <div class="info-row">
            <span class="label">Email</span>
            <span class="value">${candidate.email || "-"}</span>
          </div>

          <div class="info-row">
            <span class="label">Phone</span>
            <span class="value">${candidate.phone || "-"}</span>
          </div>
        </div>

        ${candidate.resume_url ? `
          <button id="viewResumeBtn" class="btn">
            View Resume
          </button>
        ` : ``}

      </div>

      <div class="profile-right card">

        <h2 class="section-title">Recruitment Status</h2>

        <label class="label">Status</label>
        <select id="statusSelect" class="input">
          <option value="contacted">Contacted</option>
          <option value="interview_scheduled">Interview Scheduled</option>
          <option value="interview_completed">Interview Completed</option>
          <option value="offered">Offered</option>
          <option value="rejected">Rejected</option>
        </select>

        <label class="label">Notes</label>
        <textarea id="notesInput" class="input" placeholder="Add notes..."></textarea>

        <div class="status-actions">
          <button id="saveActionBtn" class="btn">Save Action</button>
          <button id="sendEmailBtn" class="btn">Send Email</button>
          <button id="aiDraftBtn" class="btn btn-ai">✨ Draft with AI</button>
        </div>

        <div id="aiEmailBox" style="display:none; margin-top:14px;">
          <label class="label">AI-Drafted Email</label>
          <textarea id="aiEmailOutput" class="input" rows="8" style="font-size:13px;"></textarea>
          <button id="sendAiEmailBtn" class="btn" style="margin-top:8px;">Send This Email</button>
        </div>

      </div>

    </div>
  `;

  // 🔥 Load existing status
  const q = query(
    collection(db, "recruiter_actions"),
    where("candidate_id", "==", candidateId),
    where("job_id", "==", jobId)
  );

  const snapActions = await getDocs(q);

  if (!snapActions.empty) {
    const data = snapActions.docs[0].data();

    document.getElementById("statusSelect").value = data.status || "contacted";
    document.getElementById("notesInput").value = data.notes || "";
  }

  document.getElementById("saveActionBtn").onclick = async () => {

    const status = document.getElementById("statusSelect").value;
    const notes = document.getElementById("notesInput").value;

    const q = query(
      collection(db, "recruiter_actions"),
      where("candidate_id", "==", candidateId),
      where("job_id", "==", jobId)
    );

    const existing = await getDocs(q);

    if (!existing.empty) {
      const docRef = existing.docs[0].ref;

      await updateDoc(docRef, {
        status,
        notes,
        updated_at: serverTimestamp()
      });

    } else {

      await addDoc(collection(db, "recruiter_actions"), {
        candidate_id: candidateId,
        job_id: jobId,
        status,
        notes,
        created_at: serverTimestamp()
      });

    }

    alert("Saved successfully ✅");
  };

  document.getElementById("sendEmailBtn").onclick = () => {
    if (!candidate.email) {
      alert("No email available.");
      return;
    }

    const subject = encodeURIComponent("Regarding Your Application");
    const body = encodeURIComponent("Hi " + (candidate.name || "") + ",\n\nWe would like to proceed further.");

    window.location.href = `mailto:${candidate.email}?subject=${subject}&body=${body}`;
  };

  // ── AI EMAIL DRAFTER (cached by candidateId + status) ──
  const emailDraftCache = {};

  document.getElementById("aiDraftBtn").onclick = async () => {
    const btn = document.getElementById("aiDraftBtn");
    const box = document.getElementById("aiEmailBox");
    const output = document.getElementById("aiEmailOutput");

    const status = document.getElementById("statusSelect").value;
    const notes = document.getElementById("notesInput").value;

    // Return instantly if same candidate + status was already drafted
    const cacheKey = `${candidateId}:${status}`;
    if (emailDraftCache[cacheKey]) {
      console.log("Email draft cache hit:", cacheKey);
      output.value = emailDraftCache[cacheKey];
      box.style.display = "block";
      return;
    }

    btn.disabled = true;
    btn.textContent = "✨ Drafting…";

    const prompt = `You are a professional recruiter drafting a personalised outreach email.

Candidate name: ${candidate.name || "the candidate"}
Current recruitment status: ${status.replace(/_/g, " ")}
Recruiter notes: ${notes || "none"}

Write a warm, professional email (3–4 short paragraphs) appropriate for the status:
- contacted: introduce the opportunity, invite them to learn more.
- interview_scheduled: confirm details and set expectations.
- offered: congratulate and outline next steps.
- rejected: decline respectfully with encouragement.

Return ONLY the email body text, no subject line, no JSON.`;

    try {
      const draft = await callGemini(prompt);
      emailDraftCache[cacheKey] = draft;
      output.value = draft;
      box.style.display = "block";
    } catch (err) {
      console.error("AI email draft failed:", err);
      alert("AI draft failed. Please try again.");
    } finally {
      btn.disabled = false;
      btn.textContent = "✨ Draft with AI";
    }
  };

  document.getElementById("sendAiEmailBtn").onclick = () => {
    const draft = document.getElementById("aiEmailOutput").value;
    if (!candidate.email) { alert("No email available."); return; }
    const subject = encodeURIComponent("Regarding Your Application – BeyondMatch");
    window.location.href = `mailto:${candidate.email}?subject=${subject}&body=${encodeURIComponent(draft)}`;
  };
}

document.addEventListener("DOMContentLoaded", initRecruiterActionsPage);