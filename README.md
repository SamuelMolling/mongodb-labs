# 🧪 MongoDB Labs

This repository is an **experimentation and learning space** for testing MongoDB concepts, features, and use cases.

## 🎯 Purpose

**mongodb-labs** serves as a laboratory for:

- **Testing new MongoDB features** before production implementation
- **Experimenting with different patterns** for data modeling
- **Learning advanced concepts** through practical projects
- **Creating proofs of concept (PoCs)** for specific functionalities
- **Documenting findings** and best practices

## 📁 Structure

Each directory in this repository contains an independent project or experiment focused on exploring specific MongoDB concepts and features.

| Lab | Stack | What it explores |
|---|---|---|
| [`knowledge-base`](knowledge-base/) | Node.js · Next.js | AI search platform — Atlas Search + Vector Search, RRF hybrid ranking, Voyage rerank, streaming RAG answers |
| [`support-chatbot`](support-chatbot/) | Node.js · Next.js | Context-aware support agent — query condensation, tiered conversation memory, two retrieval corpora, entitlement via `$vectorSearch` filters, escalation policy |
| [`csfle`](csfle/) | Go | Client-Side Field Level Encryption with a local master key |
| [`csfle-py`](csfle-py/) | Python | Client-Side Field Level Encryption, Python driver |
| [`queryable-encryption`](queryable-encryption/) | Go · Python | Queryable Encryption — searching encrypted fields without decrypting them |
| [`todo-crud-api`](todo-crud-api/) | Go | CRUD API fundamentals, layered architecture, query logging |
| [`terraform`](terraform/) | Terraform | Atlas resource policies as infrastructure-as-code |

## 🚀 How to Use

Navigate to any project directory to find its specific README with detailed instructions:

```bash
cd <project-directory>/
cat README.md
```

## ⚠️ Important

- This is an **experimentation and learning** repository
- Projects here are **not production-ready** by default
- Use as a foundation to learn and test concepts
- Adapt and improve the code for production use

## 🤝 Contributing

Feel free to:
- Add new labs and experiments
- Improve existing projects
- Fix bugs and issues
- Share findings and learnings

## 📚 Resources

- [MongoDB Documentation](https://docs.mongodb.com/)
- [MongoDB University](https://university.mongodb.com/)
- [MongoDB Developer Center](https://www.mongodb.com/developer/)

---

**💡 Tip**: Each project is independent and can be used separately as a reference or starting point for your own experiments.
