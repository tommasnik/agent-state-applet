# sc1-idea-same-name

Dva agenti v IntelliJ IDEA, oba pracují na projektech se stejným názvem `proj1` ale v různých adresářích (`/home/tom/work/proj1` a `/home/tom/work/subfolder/proj1`). Každý agent je v jiné terminálové záložce stejné IDEA instance, takže wmctrl zobrazuje dvě okna se stejným titulem "proj1 — IntelliJ IDEA" ale různými XID.

Data jsou anonymizovaná a vytvořena manuálně dle reálného vzoru. Scénář testuje správné rozlišení focus akcí — klik na agenta A musí aktivovat záložku cc-aaaa1111 v okně 0x01e00041, klik na agenta B záložku cc-bbbb2222 v okně 0x01e00042, přestože oba projekty nesou stejný název.
