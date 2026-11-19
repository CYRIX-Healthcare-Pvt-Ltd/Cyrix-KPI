# The quotation PDF server (Render service cyrix-pdf-fonts, behind supabase/functions/qt-pdf): exactly what worked on
# Render's free plan on 19 Nov, Gotenberg's full image as it comes. Its fonts are same-width twins of the Word ones
# (Liberation for Times New Roman and Arial, Carlito for Calibri, Caladea for Cambria), so lines and pages break as in Word.
# The LibreOffice-only edition, LibreOffice restart/queue settings and Microsoft's own fonts all restarted on every PDF
# there, so none of them is used. Basic auth comes from the service's environment.
FROM gotenberg/gotenberg:8

CMD ["gotenberg", "--api-port-from-env=PORT", "--api-enable-basic-auth", "--api-timeout=90s"]
