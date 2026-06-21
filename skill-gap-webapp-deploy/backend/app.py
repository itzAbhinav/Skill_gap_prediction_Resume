"""
Skill-Gap Web App Backend
============================
Flask API that takes a resume file (PDF/DOCX) and a free-text job description,
extracts skills from both using the taxonomy-based NLP pipeline, and returns
the skill gap: which JD-required skills are missing from the resume.

Endpoints:
    POST /analyze
        form-data:
            resume: file (.pdf or .docx)
            job_description: text field
        returns JSON:
            {
              "resume_skills": [...],
              "jd_skills": [...],
              "matched_skills": [...],
              "missing_skills": [...],
              "exact_match": bool,
              "message": str,
              "ats_score": int (0-100),
              "ats_label": str,
              "ats_explanation": str,
              "fixes": [{"skill": str, "suggestion": str}, ...]
            }
"""

import os
import json
import tempfile

from flask import Flask, request, jsonify, send_file
from flask_cors import CORS

from document_parser import parse_document, UnsupportedFileTypeError
from nlp_preprocessing import extract_skills_from_text
from ats_scoring import compute_ats_score, build_fix_suggestions
from resume_tailoring import build_tailored_docx_from_existing, build_tailored_docx_from_text

app = Flask(__name__)

# CORS origins: comma-separated list via env var (set this to your Vercel URL once
# deployed, e.g. "https://your-app.vercel.app"). Defaults to "*" (allow any origin)
# so local development and quick testing work out of the box.
_allowed_origins = os.environ.get("ALLOWED_ORIGINS", "*")
if _allowed_origins == "*":
    CORS(app)
else:
    CORS(app, origins=[o.strip() for o in _allowed_origins.split(",")])

ALLOWED_EXTENSIONS = {".pdf", ".docx"}
MAX_FILE_SIZE_MB = 10
app.config["MAX_CONTENT_LENGTH"] = MAX_FILE_SIZE_MB * 1024 * 1024


@app.route("/health", methods=["GET"])
def health():
    return jsonify({"status": "ok"})


@app.route("/analyze", methods=["POST"])
def analyze():
    # --- Validate inputs ---
    if "resume" not in request.files:
        return jsonify({"error": "No resume file uploaded. Field name must be 'resume'."}), 400

    resume_file = request.files["resume"]
    job_description = request.form.get("job_description", "").strip()

    if resume_file.filename == "":
        return jsonify({"error": "No resume file selected."}), 400

    if not job_description:
        return jsonify({"error": "Job description text is empty."}), 400

    ext = os.path.splitext(resume_file.filename)[1].lower()
    if ext not in ALLOWED_EXTENSIONS:
        return jsonify({
            "error": f"Unsupported file type '{ext}'. Please upload a .pdf or .docx resume."
        }), 400

    # --- Save upload to a temp file so our existing parser (which expects a path) can read it ---
    tmp_path = None
    try:
        with tempfile.NamedTemporaryFile(delete=False, suffix=ext) as tmp:
            resume_file.save(tmp.name)
            tmp_path = tmp.name

        try:
            resume_text = parse_document(tmp_path)
        except UnsupportedFileTypeError as e:
            return jsonify({"error": str(e)}), 400

        if not resume_text or not resume_text.strip():
            return jsonify({
                "error": "Could not extract any text from the uploaded resume. "
                         "If it's a scanned/image-based PDF, text extraction won't work."
            }), 400

        # --- Skill extraction ---
        resume_skills = extract_skills_from_text(resume_text)
        jd_skills = extract_skills_from_text(job_description)

        resume_skill_set = set(resume_skills)
        jd_skill_set = set(jd_skills)

        matched_skills = sorted(resume_skill_set & jd_skill_set)
        missing_skills = sorted(jd_skill_set - resume_skill_set)

        exact_match = len(missing_skills) == 0 and len(jd_skill_set) > 0

        ats_result = compute_ats_score(jd_skill_set, matched_skills)
        fixes = build_fix_suggestions(missing_skills)

        if len(jd_skill_set) == 0:
            message = ("No recognizable skills were found in the job description text. "
                       "Try pasting the full posting, including the requirements section.")
        elif exact_match:
            message = "Skills are exactly matching"
        else:
            message = (f"{len(missing_skills)} skill(s) from the job description are missing "
                       f"from the resume.")

        return jsonify({
            "resume_skills": resume_skills,
            "jd_skills": jd_skills,
            "matched_skills": matched_skills,
            "missing_skills": missing_skills,
            "exact_match": exact_match,
            "message": message,
            "ats_score": ats_result["score"],
            "ats_label": ats_result["label"],
            "ats_explanation": ats_result["explanation"],
            "fixes": fixes,
        })

    finally:
        if tmp_path and os.path.exists(tmp_path):
            os.remove(tmp_path)


@app.route("/generate-resume", methods=["POST"])
def generate_resume():
    """
    Builds a tailored resume from the original upload plus user-approved
    skill additions, and returns it as a downloadable .docx file.

    form-data:
        resume: file (.pdf or .docx) -- the same original resume
        decisions: JSON string, a list of:
            {"skill": str, "action": "skills_only" | "bullet" | "skip", "bullet_text": str (optional)}

    Only skills with action "skills_only" or "bullet" are incorporated.
    For "bullet" actions, bullet_text must be non-empty user-written text --
    we never auto-generate a claim and insert it silently.
    """
    if "resume" not in request.files:
        return jsonify({"error": "No resume file uploaded. Field name must be 'resume'."}), 400

    resume_file = request.files["resume"]
    decisions_raw = request.form.get("decisions", "")

    if resume_file.filename == "":
        return jsonify({"error": "No resume file selected."}), 400

    try:
        decisions = json.loads(decisions_raw) if decisions_raw else []
    except json.JSONDecodeError:
        return jsonify({"error": "Invalid 'decisions' payload -- must be a JSON array."}), 400

    ext = os.path.splitext(resume_file.filename)[1].lower()
    if ext not in ALLOWED_EXTENSIONS:
        return jsonify({
            "error": f"Unsupported file type '{ext}'. Please upload a .pdf or .docx resume."
        }), 400

    skills_only = []
    bullets = []
    for d in decisions:
        skill = d.get("skill", "").strip()
        action = d.get("action", "skip")
        if not skill or action == "skip":
            continue
        if action == "skills_only":
            skills_only.append(skill)
        elif action == "bullet":
            bullet_text = d.get("bullet_text", "").strip()
            if bullet_text:  # never insert an empty/auto-generated claim
                bullets.append({"skill": skill, "text": bullet_text})

    if not skills_only and not bullets:
        return jsonify({
            "error": "No skills were selected to add. Choose at least one skill to include."
        }), 400

    tmp_upload_path = None
    tmp_output_path = None
    try:
        with tempfile.NamedTemporaryFile(delete=False, suffix=ext) as tmp:
            resume_file.save(tmp.name)
            tmp_upload_path = tmp.name

        output_fd, tmp_output_path = tempfile.mkstemp(suffix=".docx")
        os.close(output_fd)

        if ext == ".docx":
            build_tailored_docx_from_existing(tmp_upload_path, skills_only, bullets, tmp_output_path)
        else:  # .pdf -- rebuild a clean docx from extracted text
            try:
                original_text = parse_document(tmp_upload_path)
            except UnsupportedFileTypeError as e:
                return jsonify({"error": str(e)}), 400
            build_tailored_docx_from_text(original_text, skills_only, bullets, tmp_output_path)

        download_name = "tailored_resume.docx"

        response = send_file(
            tmp_output_path,
            as_attachment=True,
            download_name=download_name,
            mimetype="application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        )

        @response.call_on_close
        def _cleanup_output_file():
            if tmp_output_path and os.path.exists(tmp_output_path):
                try:
                    os.remove(tmp_output_path)
                except OSError:
                    pass

        return response

    finally:
        if tmp_upload_path and os.path.exists(tmp_upload_path):
            os.remove(tmp_upload_path)


if __name__ == "__main__":
    port = int(os.environ.get("PORT", 5000))
    app.run(debug=False, host="0.0.0.0", port=port)
