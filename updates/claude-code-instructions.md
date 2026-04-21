# Claude Code Instructions — lateeflaw.info Site Updates
# Generated as part of personal brand roadmap to $350k+
# Execute all changes in order. Each section is self-contained.

---

## CONTEXT

This is a personal portfolio site for Lateef Law, a dual CCIE-certified Enterprise Network
Architect and Cloud Infrastructure Engineer. The site is at lateeflaw.info. The goal of
these changes is to reposition the brand from "senior engineer" to "architect-level
practitioner and technical thought leader" — supporting a salary target of $350k+.

Before making any changes:
1. Read the entire codebase to understand the existing structure, CSS variables, class names, and JavaScript patterns
2. Identify the main HTML file (likely index.html) and any linked CSS/JS files
3. Do not change any existing color scheme, font choices, or overall aesthetic — match the existing design exactly
4. All new sections must use the same CSS variable naming, spacing rhythm, and component patterns already present in the codebase

---

## CHANGE 1 — Hero Section: Update Subtitle and Value Proposition

### Location
The hero section. Currently contains:
- Subtitle text: "Network Architect & Cloud Engineer"
- Hero paragraph: "Dual CCIE-certified Network Architect with 15+ years designing DoD-grade enterprise, cloud, and WAN infrastructure. Currently supporting the Defense Logistics Agency at General Dynamics — 40,000+ users across CONUS & OCONUS."

### What to change

**Subtitle** (the line directly above the H1 "LATEEF LAW"):
Replace:
```
Network Architect & Cloud Engineer
```
With:
```
Enterprise Network Architect · Cloud Infrastructure Engineer · AI-Driven Automation
```

**Hero paragraph** (the descriptive text below the credential badges):
Replace the entire paragraph with:
```
Dual CCIE-certified Network Architect and Cloud Infrastructure Engineer with 15+ years
designing mission-critical networks for the Department of Defense. Currently serving as
Enterprise Architect at General Dynamics — supporting 40,000+ users across the Defense
Logistics Agency's global WAN. Operating at the intersection of complex routing
architecture, multi-cloud infrastructure, and the future of network automation.
```

### Do not change
- The H1 "LATEEF LAW" text
- The credential badges (CCIE Enterprise, CCIE Service Provider, TS Clearance Active, BEYA 2023)
- The CTA buttons
- The animated counters
- Any hero background effects or animations

---

## CHANGE 2 — About Section: Update Body Copy

### Location
Section marked `// 01 — About`, the "Who I Am" subsection. The main paragraph text block.

### What to change

Replace the entire paragraph block (everything between the credential badges grid and the
end of the about section) with the following three paragraphs. Match the existing bold/strong
formatting pattern used in the current text:

```
Dual CCIE-certified Network Architect and Cloud Infrastructure Engineer with 15+ years
of progressive experience in enterprise networking, cloud architecture, and DoD
infrastructure.

I currently serve as Enterprise Architect and Cloud Network Engineer at General Dynamics
Information Technology, supporting the Defense Logistics Agency's global WAN —
40,000+ users across CONUS and OCONUS. I operate at the intersection of complex routing
architecture, multi-cloud infrastructure, and DoD compliance — environments where downtime
isn't measured in dollars, it's measured in operational readiness.

Beyond production infrastructure, I build at the edge of where networking meets automation
and AI — Ansible-driven configuration pipelines, PowerShell STIG automation deployed in
production at DLA, and AI-assisted workflow systems built on pgvector, Python, and
multi-agent architectures. I'm not chasing trends — I'm applying modern tooling to real
operational problems.
```

Apply bold/strong tags to the following phrases to match the existing formatting style:
- "Dual CCIE-certified Network Architect"
- "15+ years"
- "General Dynamics Information Technology"
- "40,000+ users"
- "CONUS and OCONUS"

### Do not change
- The degree/credential tiles (B.B.A., M.S., USMC Veteran, TS Clearance)
- Section heading "Who I Am"
- Section label "// 01 — About"
- Any animations or scroll effects on this section

---

## CHANGE 3 — Experience Section: Update GDIT Job Description

### Location
Section `// 03 — Experience`, the first/most recent entry:
- Date: "Dec 2018 — Present"
- Title: "Cloud Network Engineer / Enterprise Architect"
- Company: "General Dynamics Information Technology"

### What to change

Replace the existing job description paragraph with:
```
Designing and maintaining multi-cloud infrastructure (Azure, AWS, OCI, GCP) for 40,000+
DLA users across CONUS and OCONUS. Led circuit modernization initiatives resulting in
significant annual cost savings through 46 circuit transitions while improving logical
traffic routing across the global WAN. Architected L3VPN-based security zone separation
supporting firewall consolidation — eliminating the need for additional physical
infrastructure across remote sites. Identified critical design flaws in a proposed
multi-cloud SD-WAN architecture (Aviatrix), engineered a workaround solution, and kept
a major DoD cloud migration on schedule while generating substantial projected savings.
Orchestrated router refresh across 185 CONUS/OCONUS sites (216 devices). Tier III/IV
troubleshooting of MP-BGP, OSPF, DMVPN, MPLS, and IPSec architectures. STIG-compliant
network change management and SD-WAN/DoD PKI modernization.
```

### Do not change
- Job title
- Company name
- Date range
- The BEYA award callout (★ BEYA 2023 Modern-Day Technology Leader Award)
- Any other experience entries
- Formatting structure (dates, titles, company names layout)

---

## CHANGE 4 — Testimonials Section: Remove Placeholder Content

### Location
Section `// 06 — Testimonials`, "What Others Say"

### What to change

The section currently has two placeholder testimonial cards with:
- Quote: "Testimonial coming soon — reach out to collaborate or provide a recommendation."
- Initials: "A.B." and "C.D."
- Name: "Colleague Name"
- Title: "Title · Company"

**Remove the entire testimonials section from the page** — both the section label
`// 06 — Testimonials`, the heading "What Others Say", and all testimonial card
components. Remove cleanly including any containing wrapper divs specific to this section.

Also remove the "Testimonials" nav link if one exists in the navigation menu.

Do not leave any empty containers, blank space, or broken layout where the section was.
Ensure the section that previously followed testimonials (Contact / `// 07`) renders
correctly after removal with proper spacing.

---

## CHANGE 5 — Contact Section: Update Tagline

### Location
Section `// 07 — Contact` (renumber to `// 06 — Contact` after testimonials removal),
"Get In Touch". The subtext line currently reads:

```
Open to new opportunities in DoD, enterprise, and cloud networking. Reach out for
consulting, collaboration, or general inquiries.
```

And the badge/status line reads:
```
Active TS Clearance · Open to DoD & Enterprise Opportunities
```

### What to change

Replace the subtext paragraph with:
```
Available for consulting engagements, architecture advisory, and select full-time
opportunities in DoD infrastructure, cloud networking, and AI-driven network automation.
Reach out to start a conversation.
```

Replace the badge/status line with:
```
Active TS Clearance · DoD · Enterprise · Cloud · AI Automation
```

### Do not change
- Section heading "Get In Touch"
- The contact form fields (Name, Email, Message)
- The Send Message button
- Any form submission logic or JavaScript

---

## CHANGE 6 — Add Writing/Articles Section

### Location
Insert as a new section BEFORE the existing Projects section (`// 04 — Projects`).
This new section becomes `// 04 — Writing` and Projects shifts to `// 05 — Projects`.
Renumber all subsequent sections accordingly (Experience stays 03, Certs shifts up, etc.)

Update the nav menu to add a "Writing" link pointing to `#writing`, positioned between
"Experience" and "Projects" in the nav order.

### What to build

Create a new section that matches the exact visual style of the existing Projects section.
Use the same:
- Section label format (`// 04 — Writing`)
- Section heading style ("Articles & Research")
- Card component patterns from the Projects section
- Tag/badge component patterns
- Spacing and grid layout

The section should contain exactly one article card with the following content:

**Article 1:**
- Category tag: `CLOUD NETWORKING · SECURITY`
- Title: `IPSec Over High-Bandwidth Cloud Interconnects: The Throughput Problem No One Talks About`
- Description: `When security requirements mandate IPSec but a single cloud-native tunnel can't saturate a 100G interconnect, you need a real design strategy. A deep-dive into ECMP flow pinning, MACsec tradeoffs, and the backbone encryption gap the providers don't advertise.`
- Technology tags: `IPSec` `MACsec` `ECMP` `Cloud Interconnect` `Network Architecture`
- Link: `/articles/ipsec-cloud-interconnect.html`
- Link label: `Read Article →`
- Date: `March 2026`

The card must include a visible external link that navigates to the article URL above.
The link should open in the same tab (not `target="_blank"`).

After building the first card, leave a clear code comment marking where future article
cards will be inserted:
```html
<!-- FUTURE ARTICLES: Insert additional article cards here following the same pattern -->
```

---

## CHANGE 7 — Deploy Article File

### What to do

The article HTML file has already been written. Take the following steps:

1. Create a directory at the site root called `articles/`
2. Create the file `articles/ipsec-cloud-interconnect.html`
3. Populate it with the full HTML content provided below

The article file should be placed at the path:
`/articles/ipsec-cloud-interconnect.html`

So that it is accessible at:
`https://lateeflaw.info/articles/ipsec-cloud-interconnect.html`

**IMPORTANT**: The nav logo link in the article file should point back to the site root
(`href="/"`). Confirm the "Back to site" link points to `/#projects`. The LinkedIn CTA
button should point to `https://www.linkedin.com/in/lateeflaw`.

The article file content to use is in a separate file called `ipsec-cloud-interconnect.html`
that will be provided alongside these instructions. Copy it verbatim — do not modify
the article content, only confirm the nav links are correct as described above.

---

## CHANGE 8 — Section Renumbering

After all changes above, audit and update all section labels and nav links to ensure
consistent numbering:

```
// 01 — About
// 02 — Skills
// 03 — Experience
// 04 — Writing            ← NEW (Change 6)
// 05 — Projects           ← was 04
// 06 — Certifications     ← was 05
// 07 — Currently Learning ← NEW (Change 10)
// 08 — Contact            ← was 07
```

Use this final numbering:
```
Nav links: About · Skills · Experience · Writing · Projects · Certs · Learning · Contact
Section labels: // 01 through // 08
```

Update all internal anchor links to match (href="#writing", href="#projects",
href="#learning", etc.) to ensure nav clicks scroll to the correct sections.

---

## CHANGE 9 — Meta Tags Update

### Location
The `<head>` section of index.html

### What to change

Update or add the following meta tags. If a tag already exists, replace its content.
If it does not exist, add it.

```html
<meta name="description" content="Lateef Law — Dual CCIE-certified Enterprise Network Architect and Cloud Infrastructure Engineer. 15+ years designing mission-critical DoD and enterprise networks. TS Clearance. BEYA 2023.">

<meta property="og:title" content="Lateef Law — Enterprise Network Architect & Cloud Infrastructure Engineer">

<meta property="og:description" content="Dual CCIE-certified Network Architect with 15+ years in DoD infrastructure, multi-cloud architecture, and network automation. CCIE Enterprise #57597 · CCIE SP · TS Clearance Active.">

<meta property="og:url" content="https://lateeflaw.info">

<meta property="og:type" content="website">

<meta name="author" content="Lateef Law">

<meta name="keywords" content="Network Architect, Cloud Infrastructure Engineer, CCIE, DoD Networking, Enterprise Networking, Network Automation, Azure, AWS, MPLS, BGP, TS Clearance">
```

Do not remove any existing meta tags not listed here (charset, viewport, etc.)

---

## CHANGE 10 — Add "Currently Learning" Section

### Location
Insert as a new section AFTER the Certifications section (`// 06 — Certifications`)
and BEFORE the Contact section (`// 08 — Contact`). This section becomes
`// 07 — Currently Learning`.

Add a "Learning" nav link pointing to `#learning`, positioned between "Certs" and
"Contact" in the nav order.

### Purpose
This section signals active professional development to hiring managers and visitors.
It is intentionally honest and specific — not a skills list, but a live learning tracker
that shows what is being studied, why, and what the target outcome is. It updates as
progress is made rather than only appearing once skills are certified.

### What to build

Create a new section that matches the visual style of the existing Certifications or
Projects section. Use the same:
- Section label format (`// 07 — Currently Learning`)
- Section heading style ("Active Learning Tracks")
- Card/tile component patterns from existing sections
- Tag/badge component patterns
- Spacing and grid layout

The section should contain exactly one learning track card with the following content:

**Learning Track 1 — Kubernetes:**
- Track label/category: `CONTAINER ORCHESTRATION · CLOUD ARCHITECTURE`
- Title: `Kubernetes — CKA & CKS Certification Track`
- Description: `Bridging 15+ years of enterprise network architecture into cloud-native
  infrastructure. Focused on Kubernetes networking (CNI plugins, Network Policies, service
  mesh), DoD-aligned security hardening (DISA STIG, Zero Trust, RBAC), and multi-cloud
  cluster architecture across EKS, GKE, and AKS.`
- Start date label: `Started: April 2026`
- Progress indicator: Display a 4-phase progress bar or step indicator showing:
    - Phase 1: Foundations — IN PROGRESS (visually active/highlighted)
    - Phase 2: Networking Deep Dive — Upcoming
    - Phase 3: Security & DoD Compliance — Upcoming
    - Phase 4: Cloud Integration & Architecture — Upcoming
- Target certifications (displayed as small badge-style elements):
    - `CKA — Target: July 2026`
    - `CKS — Target: September 2026`
- Why this matters note (small secondary text):
  `Filling the container orchestration gap for DoD Cloud Architect and SME IV roles.`

The progress indicator must be purely HTML/CSS — no JavaScript required for the
current state. Phase 1 should be visually distinct (active color, filled indicator,
or similar treatment matching the site's existing active/highlight pattern).

After the card, leave a clear code comment for future learning tracks:
```html
<!-- FUTURE LEARNING: Insert additional learning track cards here following the same pattern -->
<!-- Update Phase progress indicators and dates as learning progresses -->
```

### Important behavior notes
- The progress indicator represents the CURRENT state at time of deployment (Phase 1 active)
- When Phase 2 begins, Claude Code will be instructed to update Phase 2 to active and
  Phase 1 to complete — do not build JavaScript-driven state management for this
- Design the phase indicators so they are easy to update via a simple class change
  (e.g., class="phase active" vs class="phase complete" vs class="phase upcoming")
- Do not add any "last updated" timestamp that would require automated updating

### Do not change
- Any existing sections
- The Certifications section — Kubernetes goes here only after CKA is earned

---

## VALIDATION CHECKLIST

After completing all changes, verify the following before considering the task complete:

**Navigation**
- [ ] Nav contains: About · Skills · Experience · Writing · Projects · Certs · Learning · Contact
- [ ] All nav links scroll to the correct sections
- [ ] Nav is consistent between desktop and mobile (if a mobile menu exists)

**Hero**
- [ ] New subtitle displays correctly
- [ ] New hero paragraph displays correctly
- [ ] Credential badges and counters still animate correctly

**About**
- [ ] Updated paragraph text is present
- [ ] Bold formatting applied to the specified phrases
- [ ] Degree/credential tiles unchanged

**Experience**
- [ ] GDIT job description updated
- [ ] BEYA callout still present
- [ ] All other experience entries unchanged

**Writing Section**
- [ ] Section exists between Experience and Projects
- [ ] Article card renders correctly with all fields
- [ ] "Read Article →" link points to `/articles/ipsec-cloud-interconnect.html`
- [ ] Future articles comment is present in the code

**Article File**
- [ ] File exists at `/articles/ipsec-cloud-interconnect.html`
- [ ] Nav logo links back to site root
- [ ] "Back to site" links to `/#projects`
- [ ] LinkedIn button links to `https://www.linkedin.com/in/lateeflaw`
- [ ] Article renders correctly in browser (open the file and visually verify)

**Testimonials**
- [ ] Entire section removed — no empty containers remain
- [ ] Contact section renders correctly with proper spacing after removal
- [ ] No "Testimonials" link in nav

**Contact**
- [ ] Updated subtext paragraph present
- [ ] Updated badge line present
- [ ] Form is unchanged and functional

**Currently Learning Section**
- [ ] Section exists between Certifications and Contact
- [ ] Section label reads `// 07 — Currently Learning`
- [ ] Kubernetes track card is present with all fields populated
- [ ] Progress indicator shows Phase 1 of 4
- [ ] Start date shows April 2026
- [ ] CKA and CKS target cert badges are present
- [ ] `<!-- FUTURE LEARNING: -->` comment is present in the code
- [ ] Section updates gracefully — no hardcoded completion states

**Meta Tags**
- [ ] All specified meta tags present in `<head>`

**No regressions**
- [ ] All existing animations still work
- [ ] All existing sections not mentioned above are visually unchanged
- [ ] Site renders correctly on mobile viewport (375px wide)
- [ ] No JavaScript console errors

---

## NOTES FOR CLAUDE CODE

- Do not make any changes not listed in this document
- If you encounter ambiguity about where exactly a piece of text appears in the source,
  search the codebase for the exact string before making assumptions
- If the site uses a build system (Vite, Webpack, etc.), run the build after changes
  and verify the output — do not just edit source files and assume they are the deployed files
- If the site is built with a framework (React, Vue, Svelte, etc.), adapt the instructions
  to the appropriate component structure while preserving all specified content exactly
- Commit message suggestion: "Brand refresh: hero, about, experience, writing section, currently learning section, article deploy, testimonials removal"
