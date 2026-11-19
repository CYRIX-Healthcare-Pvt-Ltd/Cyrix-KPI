# The quotation PDF server (Render service cyrix-pdf-fonts, behind supabase/functions/qt-pdf): Gotenberg's LibreOffice-only
# edition, as it comes. Its fonts are same-width twins of the Word ones (Liberation for Times New Roman and Arial, Carlito
# for Calibri, Caladea for Cambria), so lines and pages break as in Word. Adding Microsoft's own core fonts made it restart
# on every PDF on Render's free plan (19 Nov), so they are not added. Basic auth comes from the service's environment.
FROM gotenberg/gotenberg:8-libreoffice

CMD ["gotenberg", "--api-port-from-env=PORT", "--api-enable-basic-auth", "--api-timeout=90s", "--libreoffice-restart-after=5", "--libreoffice-max-queue-size=3"]
