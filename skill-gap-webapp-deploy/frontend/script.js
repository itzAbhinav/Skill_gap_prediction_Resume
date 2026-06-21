// ===========================================================
// Skill Gap Scanner — frontend logic
// Talks to the Flask backend at API_BASE_URL via fetch().
// ===========================================================

// Set this to your deployed Render backend URL once you have it,
// e.g. "https://skill-gap-scanner-backend.onrender.com"
// Leave as-is to keep testing against your local Flask server.
const API_BASE_URL = "http://127.0.0.1:5000";

const resumeInput = document.getElementById("resumeInput");
const dropzone = document.getElementById("dropzone");
const dropzoneContent = document.getElementById("dropzoneContent");
const dropzoneFile = document.getElementById("dropzoneFile");
const fileNameEl = document.getElementById("fileName");
const clearFileBtn = document.getElementById("clearFile");

const jdInput = document.getElementById("jdInput");
const scanBtn = document.getElementById("scanBtn");
const errorMsg = document.getElementById("errorMsg");

const inputCard = document.getElementById("inputCard");
const loading = document.getElementById("loading");
const loadingText = document.getElementById("loadingText");
const results = document.getElementById("results");

const resultBanner = document.getElementById("resultBanner");
const resultBannerText = document.getElementById("resultBannerText");
const resumeChips = document.getElementById("resumeChips");
const matchedChips = document.getElementById("matchedChips");
const missingChips = document.getElementById("missingChips");

const atsGaugeFill = document.getElementById("atsGaugeFill");
const atsScoreNumber = document.getElementById("atsScoreNumber");
const atsLabel = document.getElementById("atsLabel");
const atsExplanation = document.getElementById("atsExplanation");

const builderList = document.getElementById("builderList");
const generateBtn = document.getElementById("generateBtn");
const generateBtnText = document.getElementById("generateBtnText");
const generateErrorMsg = document.getElementById("generateErrorMsg");

// Tracks the per-skill decision state for the resume builder, keyed by skill name.
// Each entry: { action: "skip" | "skills_only" | "bullet", bulletText: string }
let skillDecisions = {};

const GAUGE_ARC_LENGTH = 204.2; // total length of the semicircle path, see style.css
const resetBtn = document.getElementById("resetBtn");

let selectedFile = null;

// ---------- File selection (click + drag/drop) ----------

dropzone.addEventListener("click", () => resumeInput.click());

resumeInput.addEventListener("change", (e) => {
  if (e.target.files.length > 0) setSelectedFile(e.target.files[0]);
});

["dragenter", "dragover"].forEach((evt) => {
  dropzone.addEventListener(evt, (e) => {
    e.preventDefault();
    dropzone.classList.add("dragover");
  });
});

["dragleave", "drop"].forEach((evt) => {
  dropzone.addEventListener(evt, (e) => {
    e.preventDefault();
    dropzone.classList.remove("dragover");
  });
});

dropzone.addEventListener("drop", (e) => {
  const file = e.dataTransfer.files[0];
  if (file) setSelectedFile(file);
});

clearFileBtn.addEventListener("click", (e) => {
  e.stopPropagation();
  selectedFile = null;
  resumeInput.value = "";
  dropzoneContent.hidden = false;
  dropzoneFile.hidden = true;
});

function setSelectedFile(file) {
  const ext = file.name.split(".").pop().toLowerCase();
  if (ext !== "pdf" && ext !== "docx") {
    showError("Please upload a .pdf or .docx file.");
    return;
  }
  hideError();
  selectedFile = file;
  fileNameEl.textContent = file.name;
  dropzoneContent.hidden = true;
  dropzoneFile.hidden = false;
}

// ---------- Error display ----------

function showError(message) {
  errorMsg.textContent = message;
  errorMsg.hidden = false;
}

function hideError() {
  errorMsg.hidden = true;
}

// ---------- Scan action ----------

scanBtn.addEventListener("click", async () => {
  hideError();

  if (!selectedFile) {
    showError("Please upload a resume first (.pdf or .docx).");
    return;
  }
  const jobDescription = jdInput.value.trim();
  if (!jobDescription) {
    showError("Please paste a job description.");
    return;
  }

  const formData = new FormData();
  formData.append("resume", selectedFile);
  formData.append("job_description", jobDescription);

  setLoading(true);

  // Render's free tier spins down idle backends; the first request after a
  // period of inactivity can take 30-60s to wake it back up. Swap the loading
  // text after a few seconds so this doesn't look like the app is frozen.
  const wakeUpTimer = setTimeout(() => {
    loadingText.textContent = "Waking up the server (free hosting naps when idle)…";
  }, 4000);

  try {
    const response = await fetch(`${API_BASE_URL}/analyze`, {
      method: "POST",
      body: formData,
    });

    const data = await response.json();

    if (!response.ok) {
      showError(data.error || "Something went wrong. Please try again.");
      setLoading(false);
      return;
    }

    renderResults(data);
    setLoading(false);
  } catch (err) {
    showError(
      "Couldn't reach the analysis server. Make sure the Flask backend is running on " +
        API_BASE_URL +
        "."
    );
    setLoading(false);
  } finally {
    clearTimeout(wakeUpTimer);
    loadingText.textContent = "Extracting skills…";
  }
});

function setLoading(isLoading) {
  scanBtn.disabled = isLoading;
  loading.hidden = !isLoading;
  if (isLoading) {
    results.hidden = true;
  }
}

// ---------- Render results ----------

function renderResults(data) {
  resultBannerText.textContent = data.message;
  resultBanner.classList.remove("is-match", "is-gap");
  resultBanner.classList.add(data.exact_match ? "is-match" : "is-gap");

  renderChipList(resumeChips, data.resume_skills, "default");
  renderChipList(matchedChips, data.matched_skills, "matched");
  renderChipList(missingChips, data.missing_skills, "missing");

  renderAtsGauge(data.ats_score, data.ats_label);
  atsExplanation.textContent = data.ats_explanation || "";

  renderResumeBuilder(data.fixes);

  inputCard.style.display = "none";
  results.hidden = false;
}

function renderAtsGauge(score, label) {
  const safeScore = Math.max(0, Math.min(100, score || 0));

  // Animate the arc fill: dashoffset goes from full length (0% shown) to 0 (100% shown)
  const offset = GAUGE_ARC_LENGTH * (1 - safeScore / 100);

  // Reset to empty first so the fill animates from 0 every time, then apply the real value
  atsGaugeFill.style.transition = "none";
  atsGaugeFill.style.strokeDashoffset = GAUGE_ARC_LENGTH;
  // Force a reflow so the browser registers the reset before re-enabling the transition
  atsGaugeFill.getBoundingClientRect();
  atsGaugeFill.style.transition = "";

  requestAnimationFrame(() => {
    atsGaugeFill.style.strokeDashoffset = offset;
  });

  atsGaugeFill.classList.remove("is-weak", "is-moderate", "is-good", "is-strong");
  if (safeScore < 40) atsGaugeFill.classList.add("is-weak");
  else if (safeScore < 70) atsGaugeFill.classList.add("is-moderate");
  else if (safeScore < 100) atsGaugeFill.classList.add("is-good");
  else atsGaugeFill.classList.add("is-strong");

  // Animate the number ticking up
  animateNumber(atsScoreNumber, safeScore);
  atsLabel.textContent = label || "";
}

function animateNumber(el, target) {
  const duration = 700;
  const start = performance.now();

  function tick(now) {
    const progress = Math.min(1, (now - start) / duration);
    const eased = 1 - Math.pow(1 - progress, 3); // ease-out cubic
    el.textContent = Math.round(target * eased);
    if (progress < 1) requestAnimationFrame(tick);
  }
  requestAnimationFrame(tick);
}

function renderResumeBuilder(fixes) {
  builderList.innerHTML = "";
  skillDecisions = {};
  hideGenerateError();

  if (!fixes || fixes.length === 0) {
    const empty = document.createElement("p");
    empty.className = "builder-list-empty";
    empty.textContent = "Nothing to tailor — every skill in the job description is already on the resume.";
    builderList.appendChild(empty);
    generateBtn.disabled = true;
    return;
  }

  fixes.forEach((fix) => {
    skillDecisions[fix.skill] = { action: "skip", bulletText: "" };

    const row = document.createElement("div");
    row.className = "builder-row";
    row.dataset.skill = fix.skill;

    const top = document.createElement("div");
    top.className = "builder-row-top";

    const name = document.createElement("span");
    name.className = "builder-skill-name";
    name.textContent = fix.skill;

    const actions = document.createElement("div");
    actions.className = "builder-actions";

    const actionDefs = [
      { key: "skip", label: "Skip" },
      { key: "skills_only", label: "Add to Skills" },
      { key: "bullet", label: "Add as bullet" },
    ];

    actionDefs.forEach((def) => {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "builder-action-btn" + (def.key === "skip" ? " is-active is-skip" : "");
      btn.textContent = def.label;
      btn.addEventListener("click", () => setSkillAction(fix.skill, def.key, fix.suggestion, row));
      actions.appendChild(btn);
    });

    top.appendChild(name);
    top.appendChild(actions);
    row.appendChild(top);
    builderList.appendChild(row);
  });

  updateGenerateButtonState();
}

function setSkillAction(skill, action, suggestedText, row) {
  skillDecisions[skill].action = action;

  // Update button active states within this row
  row.querySelectorAll(".builder-action-btn").forEach((btn) => {
    const isSkipBtn = btn.textContent === "Skip";
    const isThisAction =
      (action === "skip" && isSkipBtn) ||
      (action === "skills_only" && btn.textContent === "Add to Skills") ||
      (action === "bullet" && btn.textContent === "Add as bullet");
    btn.classList.toggle("is-active", isThisAction);
    btn.classList.toggle("is-skip", isThisAction && action === "skip");
  });

  // Show/hide the bullet textarea
  let bulletBox = row.querySelector(".builder-bullet-box");
  if (action === "bullet") {
    if (!bulletBox) {
      bulletBox = document.createElement("div");
      bulletBox.className = "builder-bullet-box";

      const label = document.createElement("label");
      label.className = "builder-bullet-label";
      label.textContent = "Your bullet text (edit freely — only what you write gets added):";

      const textarea = document.createElement("textarea");
      textarea.className = "builder-bullet-textarea";
      textarea.placeholder = "Describe how you've actually used this skill...";
      textarea.value = suggestedText || "";
      textarea.addEventListener("input", () => {
        skillDecisions[skill].bulletText = textarea.value;
        updateGenerateButtonState();
      });

      bulletBox.appendChild(label);
      bulletBox.appendChild(textarea);
      row.appendChild(bulletBox);
    }
    skillDecisions[skill].bulletText = bulletBox.querySelector("textarea").value;
  } else if (bulletBox) {
    bulletBox.remove();
  }

  updateGenerateButtonState();
}

function updateGenerateButtonState() {
  const hasAnyAction = Object.values(skillDecisions).some((d) => {
    if (d.action === "skills_only") return true;
    if (d.action === "bullet") return d.bulletText.trim().length > 0;
    return false;
  });
  generateBtn.disabled = !hasAnyAction;
}

function showGenerateError(message) {
  generateErrorMsg.textContent = message;
  generateErrorMsg.hidden = false;
}

function hideGenerateError() {
  generateErrorMsg.hidden = true;
}

function renderChipList(container, skills, variant) {
  container.innerHTML = "";

  if (!skills || skills.length === 0) {
    const empty = document.createElement("span");
    empty.className = "chip-empty";
    empty.textContent = variant === "missing" ? "None — fully covered" : "None found";
    container.appendChild(empty);
    return;
  }

  skills.forEach((skill) => {
    const chip = document.createElement("span");
    chip.className =
      variant === "matched" ? "chip chip-matched" : variant === "missing" ? "chip chip-missing" : "chip";
    chip.textContent = skill;
    container.appendChild(chip);
  });
}

// ---------- Generate tailored resume ----------

generateBtn.addEventListener("click", async () => {
  hideGenerateError();

  if (!selectedFile) {
    showGenerateError("Original resume file is no longer available — please scan again.");
    return;
  }

  const decisions = Object.entries(skillDecisions)
    .map(([skill, d]) => ({
      skill,
      action: d.action,
      bullet_text: d.bulletText || "",
    }))
    .filter((d) => d.action === "skills_only" || (d.action === "bullet" && d.bullet_text.trim()));

  if (decisions.length === 0) {
    showGenerateError("Choose at least one skill to include before generating.");
    return;
  }

  const formData = new FormData();
  formData.append("resume", selectedFile);
  formData.append("decisions", JSON.stringify(decisions));

  generateBtn.disabled = true;
  generateBtnText.textContent = "Generating…";

  try {
    const response = await fetch(`${API_BASE_URL}/generate-resume`, {
      method: "POST",
      body: formData,
    });

    if (!response.ok) {
      const data = await response.json().catch(() => ({}));
      showGenerateError(data.error || "Something went wrong generating the resume.");
      generateBtn.disabled = false;
      generateBtnText.textContent = "Generate tailored resume";
      return;
    }

    const blob = await response.blob();
    const url = window.URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "tailored_resume.docx";
    document.body.appendChild(a);
    a.click();
    a.remove();
    window.URL.revokeObjectURL(url);

    generateBtn.classList.add("is-success");
    generateBtnText.textContent = "Downloaded ✓";
    setTimeout(() => {
      generateBtn.classList.remove("is-success");
      generateBtnText.textContent = "Generate tailored resume";
      generateBtn.disabled = false;
    }, 2500);
  } catch (err) {
    showGenerateError(
      "Couldn't reach the server to generate the resume. Make sure the backend is running."
    );
    generateBtn.disabled = false;
    generateBtnText.textContent = "Generate tailored resume";
  }
});

// ---------- Reset ----------

resetBtn.addEventListener("click", () => {
  selectedFile = null;
  resumeInput.value = "";
  jdInput.value = "";
  dropzoneContent.hidden = false;
  dropzoneFile.hidden = true;
  hideError();
  hideGenerateError();
  skillDecisions = {};

  results.hidden = true;
  inputCard.style.display = "block";
});
