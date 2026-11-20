# Laboratorio 4 — Enunciado

## Actividades a realizar

### 1. Preparación

1. Crear una carpeta `laboratorio-4` e instalar las librerías oficiales de **OpenAI** y de **Anthropic**, y la que carga el `.env`.
2. Crear el archivo `.env`. El servicio del curso habla los dos formatos, así que las dos parejas usan tu misma clave:

```env
OPENAI_API_KEY=<tu clave del curso>
OPENAI_BASE_URL=https://ai.commitacademy.io/v1
ANTHROPIC_API_KEY=<tu clave del curso>
ANTHROPIC_BASE_URL=https://ai.commitacademy.io
```

---

### 2. Lo que tiene que hacer tu cliente

#### 🧩 Un contrato propio

La aplicación pide un **modelo lógico** (por ejemplo, `rapido`), no un modelo de un proveedor, y recibe siempre la misma respuesta, venga de donde venga:

- el texto
- el motivo de parada
- los tokens
- el modelo
- el destino que respondió

Si ningún tipo del contrato menciona a un proveedor, la aplicación no depende de ninguno.

> **Cómo comprobarlo:** el resumidor solo usa el cliente, nunca las librerías de OpenAI o de Anthropic directamente.

#### 🔌 Un adaptador por formato

Cada adaptador traduce entre tu contrato y una API, y es el **único sitio** donde se nota la diferencia entre proveedores.

#### ⚙️ La configuración manda, no el código

Un `config.json` dice qué modelo real tiene cada modelo de tu aplicación, **en orden**.

#### 🔁 Un plan de fallbacks

| Tipo de error | Acción |
|---|---|
| Error pasajero (`429`, `5xx` o timeout) | Probar el siguiente destino de la lista |
| Error de la petición (`400`) | **No** reintentar: fallaría igual en cualquier otro destino y solo gasta tiempo y presupuesto |

---

### 3. Punto de partida para la configuración

```json
{
  "logical_models": {
    "rapido":  [{ "destination": "curso", "model": "fast" }],
    "potente": [
      { "destination": "curso", "model": "chaos" },
      { "destination": "curso_anthropic", "model": "fast" }
    ]
  },
  "destinations": {
    "curso": {
      "format": "openai",
      "base_url_env": "OPENAI_BASE_URL",
      "api_key_env": "OPENAI_API_KEY"
    },
    "curso_anthropic": {
      "format": "anthropic",
      "base_url_env": "ANTHROPIC_BASE_URL",
      "api_key_env": "ANTHROPIC_API_KEY"
    }
  }
}
```

> 💡 `chaos` es un modelo de pruebas del servicio del curso: no cuesta nada y falla al azar con errores `429`. Sirve para ver el plan B con errores reales.

---

## 📦 Entregable

El estudiante deberá enviar un archivo `.zip` que contenga:

- 💻 **El código fuente:** el cliente, los dos adaptadores y el resumidor.
- ⚙️ **El `config.json`.**
- 📄 **Un `README` breve** con el contrato y cómo se añade un destino nuevo.
- 📸 **Una captura de cada comprobación**, donde se vea qué destino respondió.
- 📄 **Un archivo `analisis.md`** con:
  1. Qué tuviste que cambiar en el resto del cliente al añadir el adaptador de Anthropic. Si cambió algo más que el adaptador y la configuración, ¿qué mejorarías del contrato?
  2. Por qué un `400` no debe activar el fallback.

---

## 🔒 Buenas prácticas

- No incluir el `.env` ni las carpetas de dependencias (`.venv`, `node_modules`) en el `.zip`.
- No mostrar la clave en las capturas, el código ni la configuración.
- Provocar los fallos con `chaos`: las llamadas a `fast` y `smart` consumen presupuesto.
