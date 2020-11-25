import { ValidationPipe } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { tcpPort } from './environment';

async function bootstrap() {
  const app = await NestFactory.create(AppModule, {
    cors: {
      origin: true,
      exposedHeaders: ['X-Authorization','Access-Control-Allow-Origin'],
    },
    logger: ['log','error','debug','warn','verbose']
  });
  app.useGlobalPipes(new ValidationPipe({
    transform: true
  }));
  await app.listen(tcpPort);
}
bootstrap();
