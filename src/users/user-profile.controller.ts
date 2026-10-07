import { Body, Controller, Get, Patch, Req, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { Roles } from '../common/decorators/roles.decorator';
import { Role } from '../common/enums/roles.enum';
import { RolesGuard } from '../common/guards/roles.guard';
import { UpdateProfileDto } from './dto/update-profile.dto';
import { UserProfileService } from './user-profile.service';

@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(Role.Admin, Role.Recepcionista)
@Controller('users/me')
export class UserProfileController {
  constructor(private readonly profiles: UserProfileService) {}

  @Get()
  getProfile(@Req() req: { user: { id: string } }) {
    return this.profiles.getProfile(req.user.id);
  }

  @Patch()
  updateProfile(
    @Req() req: { user: { id: string } },
    @Body() dto: UpdateProfileDto,
  ) {
    return this.profiles.updateProfile(req.user.id, dto);
  }
}
