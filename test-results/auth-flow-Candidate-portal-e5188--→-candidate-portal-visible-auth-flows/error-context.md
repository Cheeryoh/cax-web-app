# Page snapshot

```yaml
- generic [active] [ref=e1]:
  - banner [ref=e2]:
    - link "CAX" [ref=e4] [cursor=pointer]:
      - /url: /
  - alert [ref=e5]
  - main [ref=e6]:
    - generic [ref=e7]:
      - generic [ref=e8]:
        - generic [ref=e9]:
          - generic [ref=e10]: Sign In
          - generic [ref=e11]: Enter your credentials to access the assessment platform
        - generic [ref=e13]:
          - generic [ref=e14]:
            - generic [ref=e15]: Username
            - textbox "Username" [ref=e16]:
              - /placeholder: username or email
              - text: demo@example.com
          - generic [ref=e17]:
            - generic [ref=e18]: Password
            - textbox "Password" [ref=e19]: Cand!date2026
          - button "Sign In" [ref=e20]
      - generic [ref=e21]:
        - generic [ref=e22]:
          - generic [ref=e23]: Demo Accounts
          - generic [ref=e24]: Use these credentials to explore the platform
        - generic [ref=e26]:
          - generic [ref=e27]:
            - paragraph [ref=e28]: Candidate
            - paragraph [ref=e29]: "Username: demo@example.com"
            - paragraph [ref=e30]: "Password: Cand!date2026"
          - generic [ref=e31]:
            - paragraph [ref=e32]: Admin
            - paragraph [ref=e33]: "Username: admin"
            - paragraph [ref=e34]: "Password: Adm!n$ecure2026"
```