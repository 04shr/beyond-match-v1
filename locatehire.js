const apiFetch = window.apiFetch;

let map;
let markersLayer;

// INIT
document.addEventListener("DOMContentLoaded", () => {
  initMap();
  loadJobsAndMarkers();
});

// MAP SETUP
function initMap() {
  map = L.map("map").setView([20, 0], 2);

  L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
    attribution: "© OpenStreetMap"
  }).addTo(map);

  markersLayer = L.markerClusterGroup({
    maxClusterRadius: 40,
    iconCreateFunction: function (cluster) {
      const count = cluster.getChildCount();
      return L.divIcon({
        html: `<div class="cluster-icon">${count}</div>`,
        className: "",
        iconSize: L.point(36, 36)
      });
    }
  }).addTo(map);
}

// LOAD JOBS + CREATE MARKERS
async function loadJobsAndMarkers() {
  const res = await apiFetch("/jobs");
  const jobs = Array.isArray(res) ? res : JSON.parse(res.body || "[]");

  markersLayer.clearLayers();

  // GROUP JOBS BY LAT+LNG
  const locationMap = {};

  jobs.forEach(job => {
    if (!job.lat || !job.lng) return;

    const key = `${job.lat},${job.lng}`;
    if (!locationMap[key]) {
      locationMap[key] = {
        lat: job.lat,
        lng: job.lng,
        title: job.city || job.location_display || "Jobs",
        jobs: []
      };
    }
    locationMap[key].jobs.push(job);
  });

  // CREATE ONE MARKER PER LOCATION
  Object.values(locationMap).forEach(loc => {
    const marker = L.marker([loc.lat, loc.lng]).addTo(markersLayer);

    marker.on("click", () => {
      showJobsForLocation(loc.title, loc.jobs);
    });
  });
}

// RIGHT PANEL RENDER
function showJobsForLocation(title, jobs) {
  const panel   = document.getElementById("cityPanel");
  const grid    = document.getElementById("panelGrid");
  const heading = document.getElementById("panelTitle");
  const count   = document.getElementById("panelCount");

  panel.classList.remove("hidden");
  heading.textContent = title;
  if (count) count.textContent = `${jobs.length} job${jobs.length === 1 ? '' : 's'} available`;

  grid.innerHTML = "";

  if (!jobs.length) {
    grid.innerHTML = `
      <div class="panel-placeholder">
        <div class="placeholder-icon">
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8">
            <circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/>
          </svg>
        </div>
        <h4>No jobs here</h4>
        <p>No openings available for this location right now.</p>
      </div>`;
    return;
  }

  jobs.forEach((job, i) => {
    const location = job.location_display || job.city || "Location not specified";
    const hasApply = job.apply_url && job.apply_url !== '#';

    grid.innerHTML += `
      <div class="panel-job-card" style="animation-delay:${i * 45}ms">
        <div class="panel-job-title">${job.title || "Job Role"}</div>
        <div class="panel-job-company">${job.company || "Company not available"}</div>

        <div class="panel-job-meta">
          <span class="panel-job-loc">
            <svg width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <path d="M21 10c0 7-9 13-9 13S3 17 3 10a9 9 0 0 1 18 0z"/><circle cx="12" cy="10" r="3"/>
            </svg>
            ${location}
          </span>
          ${job.source ? `<span class="panel-job-source">${job.source}</span>` : ''}
        </div>

        ${hasApply
          ? `<a class="panel-apply-btn" href="${job.apply_url}" target="_blank" rel="noopener noreferrer">
               <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5">
                 <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/>
                 <polyline points="15 3 21 3 21 9"/><line x1="10" y1="14" x2="21" y2="3"/>
               </svg>
               Apply Now
             </a>`
          : ''
        }
      </div>
    `;
  });
}

// CLOSE PANEL
window.closeCityPanel = function () {
  const panel = document.getElementById("cityPanel");
  const grid  = document.getElementById("panelGrid");
  panel.classList.add("hidden");
  grid.innerHTML = "";
};