# Skill Gap Scanner

An interactive web tool that compares a resume against a job description and tells you exactly what to fix.

**Input:** a resume (`.pdf` or `.docx`) + a job description (free text, pasted in)

**Output:**
- An **ATS match score** (0-100%) with a visual gauge — the percentage of job-description skills also found in the resume
- A three-column skill diff: found in resume / matched / missing for this role
- A **resume builder**: for each missing skill, choose to skip it, add it to a Skills section, or add it as a new bullet (in your own words — nothing is auto-generated and inserted as a claim). Download the result as a tailored `.docx`.
- If everything required is already present, the banner reads **"Skills are exactly matching."**

## How it works

```
Browser (HTML/CSS/JS)
    │  fetch() with FormData (file + text)
    ▼
Flask backend (app.py)
    │  POST /analyze
    │  1. Parse resume file → plain text       (document_parser.py)
    │  2. Extract skills from resume text       (nlp_preprocessing.py)
    │  3. Extract skills from JD text            (nlp_preprocessing.py)
    │  4. Compare the two skill sets
    │  5. Compute ATS score + fix suggestions    (ats_scoring.py)
    ▼
JSON response → rendered as a gauge + diff + per-skill builder in the browser
    │
    │  User picks per-skill actions (Skip / Add to Skills / Add as bullet),
    │  writes their own bullet text where relevant
    ▼
    │  POST /generate-resume (same resume file + chosen decisions)
    │  - DOCX upload: edits the real document in place    (resume_tailoring.py)
    │  - PDF upload: rebuilds a clean DOCX from extracted text
    ▼
Downloaded tailored_resume.docx
```

Skill extraction uses taxonomy-based phrase matching against a 75-skill vocabulary across 9 categories. Since the job description is free text (not matched against a predefined role), "required skills" means **whatever skills are mentioned in the JD you paste in**.

### About the ATS score

The score is intentionally simple and transparent: `(matched skills / total JD skills) * 100`. This mirrors how the keyword-screening layer of most real-world ATS software actually works — it is not a simulation of any specific vendor's proprietary algorithm, just an honest reflection of keyword overlap.

### About the resume builder

Every word in the generated resume is either (a) already present in the original upload, or (b) text the user explicitly typed in for a specific skill. The tool never auto-generates a bullet claiming experience the user didn't write themselves — it only offers a starting draft in the textarea, which the user can edit or clear before generating.

## Project structure

```
.
├── render.yaml                <- Render deployment config (backend)
├── DEPLOYMENT.md              <- step-by-step Render + Vercel hosting guide
├── backend/
│   ├── app.py                  <- Flask server + API endpoints
│   ├── ats_scoring.py           <- ATS score + fix suggestion logic
│   ├── resume_tailoring.py      <- builds the tailored .docx output
│   ├── document_parser.py       <- PDF/DOCX → text
│   ├── nlp_preprocessing.py      <- text → extracted skills
│   ├── skills_taxonomy.py        <- the 75-skill vocabulary
│   └── requirements.txt
└── frontend/
    ├── index.html
    ├── style.css
    ├── script.js
    └── vercel.json
```

## Running it locally

```bash
cd backend
pip install -r requirements.txt
python app.py
```

Then open `frontend/index.html` in your browser (or serve it with `python -m http.server 8080` inside `frontend/` if your browser blocks local-file fetch requests).

## Deploying it live

See `DEPLOYMENT.md` for the full Render (backend) + Vercel (frontend) walkthrough.

## Limitations

- Skill extraction only recognizes skills in the predefined taxonomy — a skill phrased very differently from its canonical name (e.g. "LLMs" instead of "Hugging Face Transformers") won't be caught.
- Scanned/image-based PDFs with no selectable text won't extract anything.
- The ATS score reflects keyword overlap only, the same way most real ATS keyword-screening layers work — it does not assess resume formatting, layout parsability, or content quality beyond skill presence.
- The tailored resume download is always `.docx`. For DOCX uploads, formatting is preserved as closely as possible. For PDF uploads, the original layout can't be safely edited, so a clean, simply-formatted DOCX is rebuilt from the extracted text instead — visual styling from the original PDF (fonts, columns, colors) is not preserved, only the text content.
