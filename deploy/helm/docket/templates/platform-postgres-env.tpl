{{- define "docket.platformPostgresEnv" -}}
{{- with .root -}}
{{- if and .Values.postgres.enabled .Values.postgres.bundled.enabled -}}
{{- $secret := include "docket.postgresSecret" . -}}
{{- $host := include "docket.storeName" (dict "root" . "store" "postgres") -}}
- name: DOCKET_PG_APP_PASSWORD
  valueFrom: { secretKeyRef: { name: {{ $secret }}, key: appPassword } }
- name: DOCKET_PG_URL
  value: postgres://docket_app:$(DOCKET_PG_APP_PASSWORD)@{{ $host }}:5432/docket
{{- if not $.worker }}
- name: POSTGRES_PASSWORD
  valueFrom: { secretKeyRef: { name: {{ $secret }}, key: password } }
- name: DOCKET_PG_MIGRATION_URL
  value: postgres://docket:$(POSTGRES_PASSWORD)@{{ $host }}:5432/docket
{{- end }}
{{- else if .Values.multiTenant.postgresSecret -}}
- name: DOCKET_PG_URL
  valueFrom: { secretKeyRef: { name: {{ .Values.multiTenant.postgresSecret }}, key: url } }
{{- if not $.worker }}
- name: DOCKET_PG_MIGRATION_URL
  valueFrom: { secretKeyRef: { name: {{ .Values.multiTenant.postgresSecret }}, key: migrationUrl } }
{{- end }}
{{- end -}}
{{- end -}}
{{- end }}
