# Human Prime Lab · EasyGym

App web de reservas y administración del gimnasio, conectada a Firebase (proyecto `easynegocio-6659a`).

## Pantallas (cada una independiente)

| Archivo | Para quién | Qué hace |
|---|---|---|
| `public/index.html` | Público | Pantalla de carga con logo y barra, portada, botones Reserva / Soy miembro / Recomiéndanos, servicios y contacto. **No tiene ningún acceso al admin.** |
| `public/reservar.html` | Clientes | Servicio → fecha → hora (solo cupos disponibles) → datos (nombre, teléfono, correo, edad, emergencia, observaciones) → confirmación. |
| `public/miembro.html` | Socios | Entran con su **ID de socio + últimos 4 dígitos del teléfono**. Ven si su mensualidad está activa o vencida, sus próximas reservas y mensajes del gimnasio. |
| `public/confirmar.html` | Clientes | Enlace del recordatorio (1 h antes) para confirmar asistencia o avisar que no irán. |
| `public/admin.html` | Personal | Panel de administración y recepción. Se entra escribiendo la dirección directamente (`/admin.html`). |

## Panel de administración

- **Inicio**: miembros activos, reservas de hoy, nuevos del mes, por vencer, inactivos.
- **Reservas**: agenda por día, cupos por horario, asistió / no asistió, cancelar (libera el lugar), reserva manual de recepción, **asignar ID de socio** a quien reservó por primera vez.
- **Miembros**: alta con ID (HPL-0001…), plan y vigencia, renovar, registrar asistencia, pagos, mensajes al panel, WhatsApp.
- **Servicios y cupos**: cada sección con sus propios horarios y lugares por día (las reservas no se mezclan). Generador rápido de horarios y días cerrados.
- **Planes y precios**: Mensual, Trimestral, Anual… (calcula el vencimiento).
- **Reportes**: activos, vencidos, por vencer, sin asistir +45 días, reservas por servicio, horarios más pedidos, asistencia, ingresos; exportar CSV.
- **Mensajes**: a todos, activos, vencidos, inactivos o socios elegidos; por panel del socio, WhatsApp y correo.
- **Notificaciones**: confirmar citas 1 h antes, suscripciones por vencer/vencidas, promoción a quien lleva +45 días sin venir, plantillas editables.
- **Configuración del sitio**: nombre, logos, portada (imagen y textos), botones y secciones visibles, teléfono, WhatsApp, correo, dirección, mapa, horario, redes sociales y **colores**.
- **Personal y permisos**: agrega usuarios del gimnasio y marca las casillas de las secciones que puede ver cada uno (con plantillas Recepción, Coach, Gerente, Administrador). Las reglas de Firestore también lo hacen cumplir.

## Puesta en marcha (una sola vez)

1. En la [consola de Firebase](https://console.firebase.google.com/project/easynegocio-6659a):
   - **Firestore Database** → crear base de datos (modo producción).
   - **Authentication** → Sign-in method → activar **Correo electrónico/contraseña**.
2. En esta carpeta:

```bash
firebase login
```

```bash
firebase deploy --only firestore:rules,hosting
```

3. Abre `https://easynegocio-6659a.web.app/admin.html`. La primera vez aparece **Configuración inicial**: crea la cuenta del dueño (tendrá acceso a todo).
4. En el admin: crea tus **Planes**, tus **Servicios** con sus **horarios y cupos**, y llena **Configuración del sitio** (WhatsApp, redes, dirección y la dirección pública del sitio para los enlaces de confirmación).

## Notificaciones automáticas (opcional)

Desde **Notificaciones** puedes enviar todo manualmente por WhatsApp con un clic (funciona en el plan gratuito). Para que se envíen solas:

1. Cambia el proyecto al plan **Blaze** (requerido por Cloud Functions).
2. Instala la extensión **Trigger Email** (colección `mail`) con tu servidor SMTP.
3. Despliega las funciones:

```bash
cd functions && npm install && cd .. && firebase deploy --only functions
```

4. En **Notificaciones → Plantillas y automático** activa “Envío automático por correo”.

Funciones incluidas (`functions/index.js`):
- `reservaCreada`: correo de confirmación al reservar.
- `recordatorioCitas`: cada 10 min, pide confirmar asistencia ~1 h antes.
- `avisosSocios`: diario 10:00, avisos de vencimiento y promoción a inactivos (también al panel del socio).

WhatsApp automático: define `WHATSAPP_TOKEN` y `WHATSAPP_PHONE_ID` (WhatsApp Cloud API de Meta) en `functions/.env`. Meta exige plantillas aprobadas para mensajes iniciados por el negocio fuera de la ventana de 24 h; ajusta `sendWhatsApp` si usas plantillas.

## Desarrollo local

```bash
node serve.mjs
```

Abre `http://localhost:5050`. Para probar sin tocar la base real, inicia los emuladores (requiere Java) y agrega `?emu` a la URL una vez:

```bash
firebase emulators:start --only firestore,auth
```

Cuentas de prueba del emulador: ver `dev-test-accounts.md`.

## Notas

- Las imágenes (logos, portada, servicios) se comprimen y se guardan en Firestore, así no necesitas Firebase Storage.
- La configuración de Firebase en `public/js/firebase.js` es pública por diseño; la seguridad la dan `firestore.rules`.
- Los datos personales de las reservas solo los ve el personal autorizado. El panel del socio usa una llave derivada del ID + teléfono, sin exponer la lista de socios.
