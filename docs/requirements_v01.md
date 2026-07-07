```markdown
# Product Requirements Document: Multi-Tenant RAG Knowledge Base

## 1. Product Overview
The system is a secure, multi-tenant internal knowledge management and chat application designed to store, process, and query hundreds of organizational documents (agreements, assembly decisions, protocols, reports). The MVP scope targets 20 independent tenants, with approximately 200 documents, 1GB of storage, and 400 active users per tenant.

## 2. Compliance and Security Standards
* **SOC 2 Type II Compliance:** The architecture, development lifecycle, and operational procedures must adhere to SOC 2 Trust Services Criteria, specifically Security, Availability, and Confidentiality.
* **Israeli Privacy Protection Law (PPL):** The system must facilitate compliance with Israeli privacy laws regarding the processing of personal data embedded within organizational documents.
* **Israeli Data Security Regulations (2017):** The system must meet the requirements for medium to high security level databases, enforcing strict access management, robust logging, and data encryption.
* **Accessibility:** The frontend application must meet WCAG 2.1 Level AA accessibility standards to comply with Israeli equal rights regulations.
* **Data Encryption:** All data must be encrypted at rest (AES-256) and in transit (TLS 1.3).

## 3. Multi-Tenancy and Data Isolation
* **Strict Tenant Isolation:** Data must be completely segregated. A user in one tenant must never be able to query, search, or view documents, users, or metadata belonging to another tenant.
* **Tenant Customization:** The interface must support basic tenant-specific customization, such as displaying the tenant organization name and logo.
* **Storage Quotas:** The system must enforce a default storage limit of 1GB per tenant and alert the tenant administrator when approaching this limit.

## 4. User Management and Authentication
* **Internal Identity Management:** The system will manage its own user directory without relying on an external corporate identity provider.
* **Authentication and MFA:** All user logins must enforce Multi-Factor Authentication. The system must support SMS-based MFA and an Authenticator app (TOTP) alternative.
* **Onboarding:** Upon first login, users must be prompted to accept the system Terms of Service and Privacy Policy.
* **Administration:** Tenant administrators must be able to create users manually and perform bulk imports using CSV or Excel files.

## 5. Role-Based Access Control (RBAC)
* **Folder-Level Permissions:** Access control is managed at the folder level. Administrators can assign read or edit permissions to specific users or groups for specific folders.
* **Public Folders:** Support the creation of tenant-wide public folders accessible to all users within that organization.
* **Favorites:** Users must be able to mark specific folders and documents as personal "Favorites" for quick access.

## 6. Document Management and Lifecycle
* **Supported Formats:** The system must accept PDF, DOCX, and common image formats (JPG, PNG).
* **Metadata:** Every document must store basic metadata including upload date, creator, and folder association.
* **Version Control and Updates:** Uploading a new version of a document must automatically replace the old version and immediately purge the old version's vector representations from the search index to prevent outdated retrievals.
* **Document Actions:** * Users with read access to a folder can download the original source files.
  * Users with edit access to a folder can perform a hard delete on documents. This action must permanently remove the source file, metadata, and all associated indexed data.

## 7. Personal OCR Module
* **Asynchronous Processing:** Text extraction from scanned documents and images must run asynchronously in the background.
* **User-Level Quotas:** OCR is managed on a per-user basis. Tenant administrators must be able to toggle OCR capabilities on or off for individual users and define monthly page processing quotas.
* **Progress Indication:** The interface must provide the user with clear status indicators for their personal document processing queue.

## 8. AI Chat and Search Experience
* **Hybrid Search:** The search mechanism must combine semantic vector search with traditional keyword search (BM25) to ensure high accuracy for specific query terms like dates or protocol numbers.
* **Conversational Interface:** The core interface is a natural language chat that maintains conversation history per user session.
* **Strict Grounding:** The chat responses must be strictly limited to the information contained within the ingested documents. If the answer is not in the text, the system must explicitly state that the information is not found.
* **Mandatory Citations:** Every generated response must include inline citations linking directly to the specific source documents and, where applicable, the specific pages used to formulate the answer.
* **Permission Enforcement in Chat:** The chat and search engine must only retrieve information from documents located in folders to which the querying user has explicit read access.
* **Suggested Prompts:** Following every answer, the chat interface must generate 2 to 3 contextual follow-up questions to guide the user.

## 9. Analytics and Auditing
* **Knowledge Gap Dashboard:** The system must aggregate and display analytics for tenant administrators detailing the most frequent queries that resulted in a "not found" response, highlighting missing organizational knowledge.
* **Audit Trail:** The system must maintain a secure, immutable, and SOC 2 compliant log of critical user actions, including login events, search queries executed, OCR module usage, and documents viewed, modified, or downloaded, strictly segregated by tenant.

```
