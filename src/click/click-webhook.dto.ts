import { IsNotEmpty, IsOptional, IsString } from 'class-validator';

export class ClickWebhookDto {
  @IsNotEmpty() @IsString() click_trans_id!: string;
  @IsNotEmpty() @IsString() service_id!: string;
  @IsNotEmpty() @IsString() click_paydoc_id!: string;
  @IsNotEmpty() @IsString() merchant_trans_id!: string; // Order.id
  @IsNotEmpty() @IsString() amount!: string;
  @IsNotEmpty() @IsString() action!: string; // '0' prepare | '1' complete
  @IsNotEmpty() @IsString() error!: string;
  @IsNotEmpty() @IsString() error_note!: string;
  @IsNotEmpty() @IsString() sign_time!: string;
  @IsNotEmpty() @IsString() sign_string!: string;
  @IsOptional() @IsString() merchant_prepare_id?: string;
}
