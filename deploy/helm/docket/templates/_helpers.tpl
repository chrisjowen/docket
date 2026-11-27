{{- define "docket.fullname" -}}
{{- if contains .Chart.Name .Release.Name -}}
{{- .Release.Name | trunc 63 | trimSuffix "-" -}}
{{- else -}}
{{- printf "%s-%s" .Release.Name .Chart.Name | trunc 63 | trimSuffix "-" -}}
{{- end -}}
{{- end }}

{{/* A store's name: <fullname>-<store>. */}}
{{- define "docket.storeName" -}}
{{- printf "%s-%s" (include "docket.fullname" .root) .store | trunc 63 | trimSuffix "-" -}}
{{- end }}

{{- define "docket.labels" -}}
app.kubernetes.io/name: docket
app.kubernetes.io/instance: {{ .Release.Name }}
app.kubernetes.io/version: {{ .Chart.AppVersion | quote }}
app.kubernetes.io/managed-by: {{ .Release.Service }}
helm.sh/chart: {{ .Chart.Name }}-{{ .Chart.Version | replace "+" "_" }}
{{- end }}

{{/* Selects one component's pods: docket's own (server) or a store's. */}}
{{- define "docket.selector" -}}
app.kubernetes.io/name: docket
app.kubernetes.io/instance: {{ .root.Release.Name }}
app.kubernetes.io/component: {{ .component }}
{{- end }}

{{- define "docket.image" -}}
{{ .Values.image.repository }}:{{ .Values.image.tag | default .Chart.AppVersion }}
{{- end }}

{{/*
A Secret the chart makes once and keeps: a random value for each key, the
same on every upgrade (read back from the cluster), never in the repository
or the values.
*/}}
{{- define "docket.generatedSecret" -}}
{{- $existing := lookup "v1" "Secret" .root.Release.Namespace .name }}
apiVersion: v1
kind: Secret
metadata:
  name: {{ .name }}
  labels:
    {{- include "docket.labels" .root | nindent 4 }}
  annotations:
    # Kept if the release is removed, so a store's data stays readable.
    helm.sh/resource-policy: keep
type: Opaque
data:
  {{- range .keys }}
  {{- if and $existing $existing.data (hasKey $existing.data .) }}
  {{ . }}: {{ index $existing.data . }}
  {{- else }}
  {{ . }}: {{ randAlphaNum 32 | b64enc }}
  {{- end }}
  {{- end }}
{{- end }}

{{/* The Secret holding the bundled Postgres's password. */}}
{{- define "docket.postgresSecret" -}}
{{- .Values.postgres.bundled.existingSecret | default (include "docket.storeName" (dict "root" . "store" "postgres")) -}}
{{- end }}

{{- define "docket.neo4jSecret" -}}
{{- .Values.neo4j.existingSecret | default (include "docket.storeName" (dict "root" . "store" "neo4j")) -}}
{{- end }}

{{- define "docket.qdrantSecret" -}}
{{- .Values.qdrant.existingSecret | default (include "docket.storeName" (dict "root" . "store" "qdrant")) -}}
{{- end }}

{{- define "docket.cogneeSecret" -}}
{{- .Values.cognee.existingSecret | default (include "docket.storeName" (dict "root" . "store" "cognee")) -}}
{{- end }}

{{/* The pod security every container here runs with, beyond its user. */}}
{{- define "docket.containerSecurity" -}}
allowPrivilegeEscalation: false
readOnlyRootFilesystem: true
capabilities: { drop: [ALL] }
{{- end }}
