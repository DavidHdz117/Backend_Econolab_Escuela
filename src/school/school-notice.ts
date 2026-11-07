import { SCHOOL_NOTICE_VERSION } from './domain';
export function schoolNotice() {
  return {
    version: SCHOOL_NOTICE_VERSION,
    ready: true,
    controller: 'Jesús David Saldaña Hernández',
    supportEmail: '20230009@uthh.edu.mx',
    title: 'Privacidad de Econolab',
    purposes: [
      'Permitir el acceso a una cuenta y administrar su perfil.',
      'Guardar un catálogo genérico y registros de práctica en un espacio separado por cuenta.',
      'Proteger la sesión y atender solicitudes sobre los datos personales.',
    ],
    accountData: [
      'Nombre y correo electrónico',
      'Contraseña almacenada mediante hash',
      'Rol, sesiones, dirección IP y agente de usuario',
      'Servicios genéricos y registros de práctica introducidos por la persona usuaria',
    ],
    optionalPurposes:
      'No se integran anuncios, campañas ni SDK de analítica opcional. Las preferencias opcionales comienzan desactivadas.',
    cancellation:
      'En Mi perfil → Privacidad y mis datos puedes eliminar tu cuenta, sus sesiones, preferencias y espacio de práctica. Confirma con tu contraseña y ELIMINAR MI CUENTA. Si no puedes acceder, escribe al correo de soporte con el asunto Eliminación de cuenta Econolab y tu correo registrado; no envíes contraseñas. Verificaremos tu identidad antes de atender la solicitud. La última cuenta administradora necesita que otra persona asuma esa responsabilidad. La cuenta de acceso se comparte con otros clientes del mismo servidor; eliminarla también cancela ese acceso.',
    retention:
      'Los datos de acceso y práctica se conservan mientras exista la cuenta o hasta que se reinicien los registros de práctica. La eliminación de cuenta borra el espacio de práctica asociado. No se venden datos. El proveedor de alojamiento Render y la base PostgreSQL procesan la información para prestar el servicio; el dispositivo guarda la sesión en almacenamiento seguro. Las solicitudes de eliminación se aplican al sistema activo. Los respaldos automáticos, si están habilitados, se eliminan según el ciclo de retención configurado con el proveedor.',
  };
}
export function schoolPage(deletion = false) {
  const n = schoolNotice();
  const escape = (value: string) =>
    value.replace(
      /[&<>"']/g,
      (ch) =>
        ({
          '&': '&amp;',
          '<': '&lt;',
          '>': '&gt;',
          '"': '&quot;',
          "'": '&#39;',
        })[ch]!,
    );
  const title = deletion ? 'Solicitar eliminación de cuenta' : n.title;
  return (
    '<!doctype html><html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>' +
    title +
    '</title><style>body{font:17px/1.65 system-ui;color:#172033;background:#f5f6fa;margin:0}main{max-width:760px;margin:32px auto;background:white;padding:28px;border-radius:20px}h1{color:#b91c1c}a{color:#b91c1c}</style></head><body><main><p>ECONOLAB · PRÁCTICA ADMINISTRATIVA</p><h1>' +
    title +
    '</h1><p>Versión ' +
    n.version +
    '</p><p>Responsable: ' +
    escape(n.controller) +
    '. Contacto: <a href="mailto:' +
    n.supportEmail +
    '">' +
    n.supportEmail +
    '</a>.</p><h2>Alcance</h2><p>Aplicación educativa para practicar organización de servicios genéricos y resúmenes por fecha. Utiliza ejemplos de impresión, encuadernado y asesoría de informática. Los registros son ejercicios, no ventas ni pagos. Introduce únicamente datos ficticios en el espacio de práctica.</p><h2>Datos tratados</h2><ul>' +
    n.accountData.map((value) => '<li>' + escape(value) + '</li>').join('') +
    '</ul><h2>Finalidades</h2><ul>' +
    n.purposes.map((value) => '<li>' + escape(value) + '</li>').join('') +
    '</ul><p>' +
    escape(n.optionalPurposes) +
    '</p><h2>Acceso, rectificación y eliminación</h2><p>Edita nombre y correo desde Mi perfil. ' +
    escape(n.cancellation) +
    '</p><h2>Conservación y proveedores</h2><p>' +
    escape(n.retention) +
    '</p><p>Para acceso, rectificación, cancelación u oposición y otras consultas sobre tus datos, escribe al correo de soporte. La persona responsable dará seguimiento y verificará tu identidad por un medio adecuado.</p></main></body></html>'
  );
}
