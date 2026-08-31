import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { ClsService } from 'nestjs-cls';
import { Model, Types } from 'mongoose';
import { OwnerScopedRepository } from '../scoped-repository';
import { Favorite, FavoriteDocument, FavoriteTargetType } from '../models/favorite.schema';

@Injectable()
export class FavoritesRepository extends OwnerScopedRepository<Favorite> {
  constructor(@InjectModel(Favorite.name) model: Model<Favorite>, cls: ClsService) {
    super(model, cls);
  }

  /** Newest-first — matches the list ordering convention used elsewhere (e.g. conversations). */
  listForOwner(): Promise<FavoriteDocument[]> {
    return this.find().sort({ createdAt: -1 }) as unknown as Promise<FavoriteDocument[]>;
  }

  findOne(targetType: FavoriteTargetType, targetId: Types.ObjectId): Promise<FavoriteDocument | null> {
    return this.model.findOne({ targetType, targetId, ...this.scope() }) as unknown as Promise<FavoriteDocument | null>;
  }

  addFavorite(targetType: FavoriteTargetType, targetId: Types.ObjectId): Promise<FavoriteDocument> {
    return this.model.create({ targetType, targetId, ...this.scope() }) as unknown as Promise<FavoriteDocument>;
  }

  removeFavorite(targetType: FavoriteTargetType, targetId: Types.ObjectId) {
    return this.deleteOne({ targetType, targetId });
  }
}
