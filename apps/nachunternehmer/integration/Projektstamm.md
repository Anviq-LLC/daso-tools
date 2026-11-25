# Einteilungs-Projektstamm · v10

Am 17.11.2026 aktualisierte OpenAPI gelesen und den neuen GET `/api/catalog` erfolgreich mit bestehendem Lesezugang abgerufen. Antwort: `{projects:[{id,number,name,address,archived}],subcontractors:[{id,name,archived}]}`. 13 Projekte, davon 12 aktiv.

Der Prototyp verwendet einen datierten Projektsnapshot `dist/plan-projects.json` mit Quelle montageplanung und Original-IDs. Die Projektauswahl im NU-Vertrag verwendet diese IDs; archivierte Projekte werden bei neuen Verträgen ausgeblendet. Bestehende Verträge bleiben erhalten. Keine unscharfe Verknüpfung ähnlich benannter Aufmaßprojekte. Altverträge lassen sich über die Projektauswahl bewusst zuordnen.

Für laufenden Betrieb `/source/catalog` aus read-proxy.mjs serverseitig mit vorhandener DaSo-Anmeldung und DATA_API_TOKEN anbinden. Frontend-Antwort in die normalisierte Struktur aus plan-projects.json überführen. Keine Schlüssel im Browser. Die Vorschau nutzt den Snapshot, keinen automatischen Liveabruf.

project-catalog-endpoint.mjs ist ein überholter Erweiterungsvorschlag; der bestehende API-Endpunkt `/api/catalog` genügt jetzt. Keine neue PLAN-Bindung oder Änderung vorhandener APIs nötig. Rohdaten aus `/api/plan` und `/api/aufmass` wurden für diese Änderung nicht übernommen.
