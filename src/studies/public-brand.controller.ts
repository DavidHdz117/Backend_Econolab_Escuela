import { Controller, Get, Res } from '@nestjs/common';
import { Response } from 'express';
import { join } from 'path';

@Controller('public/brand')
export class PublicBrandController {
  private sendAsset(res: Response, fileName: string) {
    res.setHeader('Cache-Control', 'public, max-age=86400');
    res.setHeader('Cross-Origin-Resource-Policy', 'cross-origin');
    return res.sendFile(join(process.cwd(), 'pdf', 'assets', fileName));
  }

  @Get('logo')
  getLogo(@Res() res: Response) {
    return this.sendAsset(res, 'econolab-logo.png');
  }

  @Get('wordmark')
  getWordmark(@Res() res: Response) {
    return this.sendAsset(res, 'econolab-brand.png');
  }
}
