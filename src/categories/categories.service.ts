import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, TreeRepository } from 'typeorm';

import { Category } from './entities/category.entity';

@Injectable()
export class CategoriesService {
  constructor(
    @InjectRepository(Category)
    private readonly categories: Repository<Category>,
    @InjectRepository(Category)
    private readonly tree: TreeRepository<Category>,
  ) {}

  findAllTree(): Promise<Category[]> {
    return this.tree.findTrees();
  }

  findActiveTree(): Promise<Category[]> {
    return this.tree.findTrees().then((tree) => filterActive(tree));
  }

  findOne(id: string): Promise<Category | null> {
    return this.categories.findOne({ where: { id } });
  }

  async create(dto: {
    slug: string;
    nameUzLatn: string;
    nameUzCyrl: string;
    nameRu: string;
    iconUrl?: string;
    sortOrder?: number;
    parentId?: string | null;
  }): Promise<Category> {
    const parent = dto.parentId ? await this.findOne(dto.parentId) : null;
    const category = this.categories.create({
      slug: dto.slug,
      nameUzLatn: dto.nameUzLatn,
      nameUzCyrl: dto.nameUzCyrl,
      nameRu: dto.nameRu,
      iconUrl: dto.iconUrl ?? null,
      sortOrder: dto.sortOrder ?? 0,
      parent,
    });
    return this.categories.save(category);
  }

  async update(
    id: string,
    dto: Partial<{
      slug: string;
      nameUzLatn: string;
      nameUzCyrl: string;
      nameRu: string;
      iconUrl: string | null;
      sortOrder: number;
      isActive: boolean;
      parentId: string | null;
    }>,
  ): Promise<Category> {
    const cat = await this.findOne(id);
    if (!cat) throw new NotFoundException('Kategoriya topilmadi');
    if (dto.parentId !== undefined) {
      cat.parent = dto.parentId ? await this.findOne(dto.parentId) : null;
    }
    if (dto.slug !== undefined) cat.slug = dto.slug;
    if (dto.nameUzLatn !== undefined) cat.nameUzLatn = dto.nameUzLatn;
    if (dto.nameUzCyrl !== undefined) cat.nameUzCyrl = dto.nameUzCyrl;
    if (dto.nameRu !== undefined) cat.nameRu = dto.nameRu;
    if (dto.iconUrl !== undefined) cat.iconUrl = dto.iconUrl;
    if (dto.sortOrder !== undefined) cat.sortOrder = dto.sortOrder;
    if (dto.isActive !== undefined) cat.isActive = dto.isActive;
    return this.categories.save(cat);
  }

  async remove(id: string): Promise<void> {
    const result = await this.categories.delete(id);
    if (!result.affected) throw new NotFoundException('Kategoriya topilmadi');
  }
}

function filterActive(nodes: Category[]): Category[] {
  return nodes
    .filter((n) => n.isActive)
    .map((n) => ({ ...n, children: n.children ? filterActive(n.children) : [] }));
}
