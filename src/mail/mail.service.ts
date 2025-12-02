import { Inject, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Transporter } from 'nodemailer';
import { MAILER_TRANSPORT } from './constants';

export interface EmailPayload {
  nombre: string;
  email: string;
  token: string;
}

@Injectable()
export class MailService {
  constructor(
    @Inject(MAILER_TRANSPORT) private readonly transporter: Transporter,
    private readonly config: ConfigService,
  ) { }

  async sendConfirmationEmail({ nombre, email, token }: EmailPayload) {
    await this.transporter.sendMail({
      from: `Econolab Huejutla <${this.config.get('GMAIL_USER')}>`,
      to: email,
      subject: 'Econolab Huejutla – Confirma tu cuenta',
      html: `
        <p>Hola ${nombre}, has creado tu cuenta en Econolab Huejutla, ya casi está lista.</p>
        <p>Visita el siguiente enlace:</p>
        <a href="${this.config.get('FRONTEND_URL')}/auth/confirm-account">Confirmar cuenta</a>
        <p>e ingresa el código: <b>${token}</b></p>
        `,
    });
  }

  async sendPasswordResetToken({ nombre, email, token }: EmailPayload) {
    await this.transporter.sendMail({
      from: `Econolab Huejutla <${this.config.get('GMAIL_USER')}>`,
      to: email,
      subject: 'Econolab Huejutla – Restablece tu contraseña',
      html: `
        <p>Hola ${nombre}, has solicitado restablecer tu contraseña.</p>
        <p>Visita el siguiente enlace:</p>
        <a href="${this.config.get('FRONTEND_URL')}/auth/new-password">Restablecer contraseña</a>
        <p>e ingresa el código: <b>${token}</b></p>
        `,
    });
  }

  async sendMfaCode(payload: { nombre: string; email: string; code: string }) {
    const { nombre, email, code } = payload;

    await this.transporter.sendMail({
      from: `Econolab Huejutla <${this.config.get('GMAIL_USER')}>`,
      to: email,
      subject: 'Econolab Huejutla – Código de verificación',
      html: `
        <p>Hola ${nombre},</p>
        <p>Tu código de verificación es:</p>
        <h2 style="font-size: 24px; margin: 10px 0; color: #333;">${code}</h2>
        <p>Ingresa este código para continuar con tu verificación.</p>
        <p>Si no solicitaste este código, puedes ignorar este mensaje.</p>
      `,
    });
  }
}
