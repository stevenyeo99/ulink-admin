## AI Engineering Principle — Risk-Based Human-in-the-Loop & Continuous Improvement

### Core Philosophy

**AI proposes, the system validates, humans handle exceptions, and verified feedback improves future predictions.**

The objective is to **maximize automation, minimize manual intervention, and maintain reliable accuracy**, rather than expecting the LLM to be 100% correct.

### Engineering Guidelines

1. **AI-Assisted Extraction**
   - Treat LLM Vision output as predictions, never guaranteed truth.
   - Use structured outputs and field-level validation.

2. **Risk-Based Human-in-the-Loop (HITL)**
   - Do not require users to verify every extracted field.
   - Automatically process low-risk fields that pass independently validated checks.
   - Require human review for uncertain, inconsistent, or high-risk fields.
   - High-risk fields must not be automatically approved based solely on LLM confidence.

3. **Exception-Based Processing**
   - Flag only fields requiring attention.
   - Allow users to correct individual fields instead of reprocessing entire documents.
   - Prioritize reducing manual workload and processing time.

4. **Feedback-Driven RAG**
   - Store verified user corrections in PostgreSQL/pgvector.
   - Retrieve relevant historical corrections during future extraction.
   - Dynamically inject verified examples into prompts without retraining the model.
   - Never blindly reuse historical values as facts about new documents.

5. **Confidence & Validation**
   - Do not blindly trust LLM-generated confidence scores.
   - Combine deterministic business rules, source evidence, and historically calibrated confidence.
   - Use field-specific review thresholds based on business risk.

6. **Continuous Evaluation**
   - Compare AI predictions against verified ground-truth data.
   - Track extraction accuracy, manual review rate, undetected errors, and processing time.
   - Evaluate prompt or model changes before deployment.
   - Never automatically deploy prompt changes without regression testing and approval.

7. **Cost & Automation Efficiency**
   - The system must reduce total manual effort, not simply shift manual data entry into manual verification.
   - Measure Straight-Through Processing (STP) rate, manual time saved, error rate, and cost per document.
   - Optimize automation while maintaining acceptable business risk.

### Recommended Architecture

Node.js API → Document Processing → LM Studio Vision/Reasoning → Field-Level Validation → Risk-Based Decision → Auto-Process or Human Review → Verified Feedback → Supabase pgvector → Future RAG Retrieval.

### Development Rules for Claude Code

- Prefer improving the existing architecture over introducing unnecessary frameworks.
- Design validation, confidence scoring, and review decisions as separate components.
- Make review thresholds configurable by document type and field risk.
- Preserve original AI output, corrected values, model versions, and audit history.
- Do not allow unverified corrections into RAG memory.
- Prevent sensitive information from leaking across clients through retrieval.
- Design for measurable improvement, scalability, and minimal human intervention.
- Ensure automated processing has a safe fallback when validation fails.
- Do not assume feedback-driven RAG automatically improves OCR; verify gains through evaluation.

### Success Criteria

**A successful AI system is not one that never makes mistakes. It is one that detects and manages mistakes, reduces manual work, learns from verified corrections, and demonstrates measurable business value.**