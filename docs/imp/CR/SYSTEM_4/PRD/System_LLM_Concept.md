Feedback-Driven RAG with Dynamic Prompt Engineering and Automated Evaluation. User corrections are stored as verified knowledge, retrieved dynamically during future inference, and evaluated against ground-truth data to improve extraction accuracy without model retraining.

AI proposes, humans verify, and the system learns from verified feedback.

Design a Human-in-the-Loop AI Fallback Architecture with Feedback-Driven RAG and Continuous Evaluation. Treat LLM Vision output as unverified predictions, use field-level validation and human correction as safeguards, and reuse verified feedback to improve future document extraction without model retraining.

The purpose of introducing Human-in-the-Loop is not to make users verify everything again.

Our objective is to automate most of the document processing and only require human intervention when the AI is uncertain or detects potential errors.

Over time, the system can use verified corrections to improve future extraction accuracy, reducing the amount of manual review required.

The goal is not 100% AI accuracy, but to significantly reduce manual workload while maintaining reliable results.