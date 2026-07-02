> **Extra context need**: audience tech level + users' mental state in context.

Find unclear, confusing, poorly written interface text. Rewrite it. Vague copy = support tickets + abandonment; specific copy get users through task.


---

## Assess Current Copy

ID what makes text unclear or weak:

1. **Find clarity problems**:
   - **Jargon**: Tech terms users won't get
   - **Ambiguity**: Multiple reads possible
   - **Passive voice**: "Your file has been uploaded" vs "We uploaded your file"
   - **Length**: Too wordy or too terse
   - **Assumptions**: Assume knowledge user lacks
   - **Missing context**: Users don't know what to do or why
   - **Tone mismatch**: Too formal, too casual, wrong fit for situation

2. **Understand context**:
   - Audience? (Technical? General? First-timer?)
   - User mental state? (Stressed during error? Confident during success?)
   - Action wanted?
   - Constraint? (Char limits? Space limits?)

**CRITICAL**: Clear copy help users succeed. Unclear copy = frustration, errors, support tickets.

## Plan Copy Improvements

Strategy for clearer comms:

- **Primary message**: ONE thing users need know
- **Action needed**: What users do next (if anything)
- **Tone**: Feel how? (Helpful? Apologetic? Encouraging?)
- **Constraints**: Length limits, brand voice, localization

**IMPORTANT**: Good UX writing invisible. Users understand instant, no notice of words.

## Improve Copy Systematically

Refine text, common areas:

### Error Messages
**Bad**: "Error 403: Forbidden"
**Good**: "You don't have permission to view this page. Contact your admin for access."

**Bad**: "Invalid input"
**Good**: "Email addresses need an @ symbol. Try: name@example.com"

**Principles**:
- Say what went wrong, plain language
- Suggest fix
- Don't blame user
- Examples when useful
- Link help/support if applicable

### Form Labels & Instructions
**Bad**: "DOB (MM/DD/YYYY)"
**Good**: "Date of birth" (placeholder shows format)

**Bad**: "Enter value here"
**Good**: "Your email address" or "Company name"

**Principles**:
- Clear specific labels (not generic placeholders)
- Show format via examples
- Explain why asking (when not obvious)
- Instructions before field, not after
- Required-field marks clear

### Button & CTA Text
**Bad**: "Click here" | "Submit" | "OK"
**Good**: "Create account" | "Save changes" | "Got it, thanks"

**Principles**:
- Describe action specific
- Active voice (verb + noun)
- Match user mental model
- Specific ("Save" beat "OK")

### Help Text & Tooltips
**Bad**: "This is the username field"
**Good**: "Choose a username. You can change this later in Settings."

**Principles**:
- Add value (don't repeat label)
- Answer implicit question ("What is this?" / "Why need this?")
- Brief but complete
- Link detailed docs if needed

### Empty States
**Bad**: "No items"
**Good**: "No projects yet. Create your first project to get started."

**Principles**:
- Explain why empty (if not obvious)
- Show next action clear
- Welcoming, not dead-end

### Success Messages
**Bad**: "Success"
**Good**: "Settings saved! Your changes will take effect immediately."

**Principles**:
- Confirm what happened
- Explain what's next (if relevant)
- Brief but complete
- Match user emotional moment (celebrate big wins)

### Loading States
**Bad**: "Loading..." (for 30+ seconds)
**Good**: "Analyzing your data... this usually takes 30-60 seconds"

**Principles**:
- Set expectations (how long?)
- Explain what's happening (when not obvious)
- Show progress when can
- Escape hatch if fit ("Cancel")

### Confirmation Dialogs
**Bad**: "Are you sure?"
**Good**: "Delete 'Project Alpha'? This can't be undone."

**Principles**:
- State specific action
- Explain consequences (esp destructive)
- Clear button labels ("Delete project" not "Yes")
- Don't overuse confirms (only risky actions)

### Navigation & Wayfinding
**Bad**: Generic labels like "Items" | "Things" | "Stuff"
**Good**: Specific labels like "Your projects" | "Team members" | "Settings"

**Principles**:
- Specific + descriptive
- Language users get (not internal jargon)
- Hierarchy clear
- Info scent (breadcrumbs, current location)

## Apply Clarity Principles

Every copy piece follow these rules:

1. **Specific**: "Enter email" not "Enter value"
2. **Concise**: Cut extra words (keep clarity though)
3. **Active**: "Save changes" not "Changes will be saved"
4. **Human**: "Oops, something went wrong" not "System error encountered"
5. **Tell users what to do**, not just what happened
6. **Consistent**: Same terms throughout (don't vary for variety)

**NEVER**:
- Jargon without explain
- Blame users ("You made an error" → "This field is required")
- Vague ("Something went wrong" no explain)
- Passive voice unneeded
- Overly long explains (concise)
- Humor for errors (empathy instead)
- Assume tech knowledge
- Vary terminology (pick one, stick)
- Repeat info (headers restate intros, redundant explains)
- Placeholders as only labels (vanish when typed)

## Verify Improvements

Test copy improvements work:

- **Comprehension**: Users understand no context?
- **Actionability**: Users know next step?
- **Brevity**: Short as possible, still clear?
- **Consistency**: Match terminology elsewhere?
- **Tone**: Fit situation?

Copy read clean → hand off to `/impeccable polish` for final pass.

---

## Reference Material

Sections below = old `ux-writing.md`, live inline now. Clarify flow keep deep UX-writing ref one place.

### UX Writing

#### The Button Label Problem

**Never use "OK", "Submit", or "Yes/No".** Lazy, ambiguous. Use verb + object patterns:

| Bad | Good | Why |
|-----|------|-----|
| OK | Save changes | Says what happens |
| Submit | Create account | Outcome-focused |
| Yes | Delete message | Confirms action |
| Cancel | Keep editing | Clarifies "cancel" meaning |
| Click here | Download PDF | Describes destination |

**Destructive actions**, name destruction:
- "Delete" not "Remove" (delete permanent, remove implies recoverable)
- "Delete 5 items" not "Delete selected" (show count)

#### Error Messages: The Formula

Every error answer: (1) What happened? (2) Why? (3) How fix? Ex: "Email address isn't valid. Please include an @ symbol." not "Invalid input".

##### Error Message Templates

| Situation | Template |
|-----------|----------|
| **Format error** | "[Field] needs to be [format]. Example: [example]" |
| **Missing required** | "Please enter [what's missing]" |
| **Permission denied** | "You don't have access to [thing]. [What to do instead]" |
| **Network error** | "We couldn't reach [thing]. Check your connection and [action]." |
| **Server error** | "Something went wrong on our end. We're looking into it. [Alternative action]" |

##### Don't Blame the User

Reframe: "Please enter a date in MM/DD/YYYY format" not "You entered an invalid date".

#### Empty States Are Opportunities

Empty states = onboarding moments: (1) Brief ack, (2) Explain value of filling, (3) Clear action. "No projects yet. Create your first one to get started." not just "No items".

#### Voice vs Tone

**Voice** = brand personality, same everywhere.
**Tone** adapts to moment.

| Moment | Tone Shift |
|--------|------------|
| Success | Celebratory, brief: "Done! Your changes are live." |
| Error | Empathetic, helpful: "That didn't work. Here's what to try..." |
| Loading | Reassuring: "Saving your work..." |
| Destructive confirm | Serious, clear: "Delete this project? This can't be undone." |

**Never humor for errors.** Users already frustrated. Helpful, not cute.

#### Writing for Accessibility

**Link text** needs standalone meaning: "View pricing plans" not "Click here". **Alt text** describes info, not image: "Revenue increased 40% in Q4" not "Chart". Use `alt=""` decorative images. **Icon buttons** need `aria-label` for screen reader context.

#### Writing for Translation

##### Plan for Expansion

German text ~30% longer than English. Allocate space:

| Language | Expansion |
|----------|-----------|
| German | +30% |
| French | +20% |
| Finnish | +30-40% |
| Chinese | -30% (fewer chars, same width) |

##### Translation-Friendly Patterns

Keep numbers separate ("New messages: 3" not "You have 3 new messages"). Full sentences as single strings (word order vary by language). Skip abbreviations ("5 minutes ago" not "5 mins ago"). Give translators context on where strings appear.

#### Consistency: The Terminology Problem

Pick one term, stick:

| Inconsistent | Consistent |
|--------------|------------|
| Delete / Remove / Trash | Delete |
| Settings / Preferences / Options | Settings |
| Sign in / Log in / Enter | Sign in |
| Create / Add / New | Create |

Build terminology glossary, enforce it. Variety = confusion.

#### Avoid Redundant Copy

Heading explains it → intro redundant. Button clear → don't re-explain. Say once, say well.

#### Loading States

Specific: "Saving your draft..." not "Loading...". Long waits: set expectations ("This usually takes 30 seconds") or show progress.

#### Confirmation Dialogs: Use Sparingly

Most confirm dialogs = design failures; consider undo instead. Must confirm: name action, explain consequences, specific button labels ("Delete project" / "Keep project", not "Yes" / "No").

#### Form Instructions

Show format via placeholders, not instructions. Non-obvious fields: explain why asking.

---

**Avoid**: Jargon no explain. Blame users ("You made an error" → "This field is required"). Vague errors ("Something went wrong"). Vary terminology for variety. Humor for errors.