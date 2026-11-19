# The quotation PDF server (Render service behind supabase/functions/qt-pdf): Gotenberg's LibreOffice with the real
# Times New Roman, Arial, Courier New, Georgia, Verdana and the other Microsoft core fonts, which Microsoft lets anyone
# share. Without them LibreOffice used look-alikes: same widths, but lines sat a little differently (SIGNATURE 17 pt lower
# on Giri Pushp, 19 Nov). Calibri and Cambria cannot be shared; their same-width twins Carlito and Caladea are already in
# the image. Render builds this folder (Root Directory: pdf-server); basic auth comes from the service's environment.
FROM gotenberg/gotenberg:8

USER root
# The fonts come from Debian's "contrib" part: added to whichever kind of sources file the image has.
RUN set -eux; \
    if [ -f /etc/apt/sources.list.d/debian.sources ]; then \
      sed -i -E 's/^(Components:.*\bmain\b)(.*)$/\1 contrib\2/' /etc/apt/sources.list.d/debian.sources; \
    else \
      sed -i -E 's/^(deb .* main)(.*)$/\1 contrib\2/' /etc/apt/sources.list; \
    fi; \
    apt-get update; \
    echo "ttf-mscorefonts-installer msttcorefonts/accepted-mscorefonts-eula select true" | debconf-set-selections; \
    DEBIAN_FRONTEND=noninteractive apt-get install -y --no-install-recommends ttf-mscorefonts-installer; \
    fc-cache -f; \
    # The build stops here if the real fonts did not arrive, rather than going live with look-alikes.
    fc-list | grep -qi "Times New Roman"; \
    fc-list | grep -qi "Arial"; \
    rm -rf /var/lib/apt/lists/*
USER gotenberg

CMD ["gotenberg", "--api-port-from-env=PORT", "--api-enable-basic-auth", "--api-timeout=90s"]
