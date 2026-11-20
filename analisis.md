# Análisis — Laboratorio 4

## 1. Qué cambió al añadir el adaptador de Anthropic

Tuve que crear un adaptador nuevo para manejar el caso de Anthropic y registrar ese proveedor en el cliente. Nada más. El contrato no cambió, porque lo armé de forma general para que sirva con cualquier SDK.

### Qué mejoraría del contrato

- **`maxTokens`.** Es opcional en OpenAI pero obligatorio en Anthropic, así que la respuesta puede variar según el modelo que responda. Pondría un valor por defecto en el contrato, para que se aplique igual cuando no se pasa el dato.
- **`stopReason`.** Ahora es muy general. Lo mejoraría para cubrir mejor los distintos motivos de parada de cada proveedor.

## 2. Por qué un 400 no debe activar el fallback

Un 400 es un error de la petición: cambiar de modelo no lo soluciona, porque fallaría igual. Además, cada reintento es un gasto para el usuario.
