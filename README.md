# 💰 WEALTHY

**Track. Understand. Save.**

A premium India-focused personal finance SaaS — full-stack with a 3D metallic card, glassmorphism auth, receipt-style bills, AI assistant, and 15+ fully working pages.

![Wealthy](https://img.shields.io/badge/Wealthy-v1.0.0-0F7A4D?style=for-the-badge)
![Node](https://img.shields.io/badge/Node.js-18+-16A34A?style=for-the-badge&logo=node.js)
![License](https://img.shields.io/badge/License-MIT-blue?style=for-the-badge)

---

## 🏢 Company

| Field | Info |
|-------|------|
| **Owner** | SANJEEV SHEKHAR |
| **Email** | sanjeev@wealthy.in |
| **Parent Company** | D2C Ventures |
| **Made in** | India 🇮🇳 |

---

## ✨ Features

### 🎨 Design
- 🃏 **3D Rotating Metallic Card** — Play/Pause control + 8 color finishes
- 🔵 **Dot grid backgrounds** — Subtle textures across every page
- 📊 **Graph-grid charts** — Clean gridlines behind all visualizations
- 🪟 **Glassmorphism auth** — Frosted glass with animated gradient orbs
- 🌓 **Light / Dark mode** — Persisted to your account
- ⚡ **Physics animations** — Spring easing, magnetic hover, shimmer effects

### 💼 Functionality
- 🔐 **Full Authentication** — Sign Up / Sign In / Logout with JWT + bcrypt
- 💸 **Transactions** — Add, edit, delete with smart filters (UPI, Cards, Cash, Bank, Income, Expense)
- 📅 **Money Calendar** — Full month navigation + day-by-day transaction detail
- 🧾 **Receipt-style Bills** — Thermal printer aesthetic with barcode
- 🎯 **Budgets** — Progress bars with healthy/warning/danger states
- 🏆 **Savings Goals** — Custom colors + circular progress rings
- 📈 **Reports** — Beautiful colourful PDF + CSV export
- 🤖 **AI Assistant** — Glowing input with smart suggestions
- 💳 **Accounts & Cards** — Profile card + additional cards management
- 📱 **UPI Hub** — Add UPI ID + upload QR for receiving payments
- 🔔 **Notifications** — Real-time badge with dropdown panel
- 👤 **My Profile** — Editable name, card number, expiry (auto-slash MM/YY)
- ⚙️ **Settings** — Theme, currency, appearance, security

### 🇮🇳 India-Focused
- ₹ INR currency formatting (lakhs/crores)
- UPI methods: Google Pay, PhonePe, Paytm, BHIM
- Banks: HDFC, ICICI, SBI
- NPCI-compliant messaging
- Masked card display (`•••• 4821`)

---

## 🛠️ Tech Stack

| Layer | Technology |
|-------|-----------|
| **Frontend** | Pure HTML + CSS + JavaScript (no framework) |
| **Backend** | Node.js + Express |
| **Database** | SQLite (better-sqlite3) |
| **Auth** | JWT + bcryptjs |
| **Icons** | Custom SVG outline system |
| **Fonts** | Plus Jakarta Sans |
| **Deployment** | Render.com |

---

## 🚀 Quick Start (Local)

```bash
# 1. Clone the repository
git clone https://github.com/sanjeevy2009-ui/Wealthy-2.git
cd Wealthy-2

# 2. Install dependencies
npm install

# 3. Start the server
npm start

# Or with auto-reload
npm run dev
