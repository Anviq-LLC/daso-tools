# Shared design

`daso-tokens.css` holds the colors, radii, shadow and font that all DaSo apps share. Aufmass, Lohn and the
Dashboard already use these values. Nachunternehmer and Mitarbeiter import the file as `daso-tokens.css`.

Workers Builds only sees one app folder, so the file is copied into each app and the copies are committed:

    node design/sync.mjs

Change a value in `design/daso-tokens.css`, run the command, commit the copies.

Header pattern for every app: logo, "DaSo Lüftungsbau" in bold and the app name below it, and a page title of
the form "DaSo · App".
