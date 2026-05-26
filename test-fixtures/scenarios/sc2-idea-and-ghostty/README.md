# sc2-idea-and-ghostty

Jeden agent běží v IntelliJ IDEA (projekt `myapp`), druhý v terminálu Ghostty (projekt `backend`). Oba agenti jsou viditelní v appletu současně. wmctrl zobrazuje dvě okna s různými tituly — IDEA okno a Ghostty okno.

Data jsou anonymizovaná a vytvořena manuálně dle reálného vzoru. Scénář testuje větvení focus logiky podle `terminal_type`: klik na agenta A volá IDEA plugin API (tabName=cc-cccc3333) a přepne okno přes wmctrl, zatímco klik na agenta B (Ghostty) pouze přepne okno přes wmctrl — IDEA API se nevolá, protože Ghostty plugin neexistuje.
