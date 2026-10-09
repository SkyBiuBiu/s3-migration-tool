import json
import logging
from typing import List, Optional

from datetime import datetime, date

from fastapi import APIRouter, Body, Depends, HTTPException, Query
from pydantic import BaseModel
from sqlalchemy.ext.asyncio import AsyncSession

from core.database import get_db
from services.storage_connections import Storage_connectionsService
from dependencies.auth import get_current_user
from schemas.auth import UserResponse

# Set up logging
logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/v1/entities/storage_connections", tags=["storage_connections"])


# ---------- Pydantic Schemas ----------
class Storage_connectionsData(BaseModel):
    """Entity data schema (for create/update)"""
    name: str
    endpoint: str = None
    region: str = None
    access_key: str
    secret_key: str
    bucket: str
    path_style: bool = None


class Storage_connectionsUpdateData(BaseModel):
    """Update entity data (partial updates allowed)"""
    name: Optional[str] = None
    endpoint: Optional[str] = None
    region: Optional[str] = None
    access_key: Optional[str] = None
    secret_key: Optional[str] = None
    bucket: Optional[str] = None
    path_style: Optional[bool] = None


class Storage_connectionsResponse(BaseModel):
    """Entity response schema"""
    id: int
    user_id: str
    name: str
    endpoint: Optional[str] = None
    region: Optional[str] = None
    access_key: str
    secret_key: str
    bucket: str
    path_style: Optional[bool] = None
    created_at: Optional[datetime] = None
    updated_at: Optional[datetime] = None

    class Config:
        from_attributes = True


class Storage_connectionsListResponse(BaseModel):
    """List response schema"""
    items: List[Storage_connectionsResponse]
    total: int
    skip: int
    limit: int


class Storage_connectionsBatchCreateRequest(BaseModel):
    """Batch create request"""
    items: List[Storage_connectionsData]


class Storage_connectionsBatchUpdateItem(BaseModel):
    """Batch update item"""
    id: int
    updates: Storage_connectionsUpdateData


class Storage_connectionsBatchUpdateRequest(BaseModel):
    """Batch update request"""
    items: List[Storage_connectionsBatchUpdateItem]


class Storage_connectionsBatchDeleteRequest(BaseModel):
    """Batch delete request"""
    ids: List[int]


# ---------- Routes ----------
@router.get("", response_model=Storage_connectionsListResponse)
async def query_storage_connectionss(
    query: str = Query(None, description='Query conditions as JSON, e.g. {"id":2} or {"id":{"$gte":2}}'),
    sort: str = Query(None, description="Sort field (prefix with '-' for descending)"),
    skip: int = Query(0, ge=0, description="Number of records to skip"),
    limit: int = Query(20, ge=1, le=2000, description="Max number of records to return"),
    fields: str = Query(None, description="Comma-separated list of fields to return"),
    current_user: UserResponse = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Query storage_connectionss with filtering, sorting, and pagination (user can only see their own records)"""
    logger.debug(f"Querying storage_connectionss: query={query}, sort={sort}, skip={skip}, limit={limit}, fields={fields}")
    
    service = Storage_connectionsService(db)
    try:
        # Parse query JSON if provided
        query_dict = None
        if query:
            try:
                query_dict = json.loads(query)
            except json.JSONDecodeError:
                raise HTTPException(status_code=400, detail="Invalid query JSON format")
        
        result = await service.get_list(
            skip=skip, 
            limit=limit,
            query_dict=query_dict,
            sort=sort,
            user_id=str(current_user.id),
        )
        logger.debug(f"Found {result['total']} storage_connectionss")
        return result
    except HTTPException:
        raise
    except ValueError as e:
        logger.warning(f"Invalid storage_connections query: {str(e)}")
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        logger.error(f"Error querying storage_connectionss: {str(e)}", exc_info=True)
        raise HTTPException(status_code=500, detail=f"Internal server error: {str(e)}")


@router.get("/all", response_model=Storage_connectionsListResponse)
async def query_storage_connectionss_all(
    query: str = Query(None, description='Query conditions as JSON, e.g. {"id":2} or {"id":{"$gte":2}}'),
    sort: str = Query(None, description="Sort field (prefix with '-' for descending)"),
    skip: int = Query(0, ge=0, description="Number of records to skip"),
    limit: int = Query(20, ge=1, le=2000, description="Max number of records to return"),
    fields: str = Query(None, description="Comma-separated list of fields to return"),
    db: AsyncSession = Depends(get_db),
):
    # Query storage_connectionss with filtering, sorting, and pagination without user limitation
    logger.debug(f"Querying storage_connectionss: query={query}, sort={sort}, skip={skip}, limit={limit}, fields={fields}")

    service = Storage_connectionsService(db)
    try:
        # Parse query JSON if provided
        query_dict = None
        if query:
            try:
                query_dict = json.loads(query)
            except json.JSONDecodeError:
                raise HTTPException(status_code=400, detail="Invalid query JSON format")

        result = await service.get_list(
            skip=skip,
            limit=limit,
            query_dict=query_dict,
            sort=sort
        )
        logger.debug(f"Found {result['total']} storage_connectionss")
        return result
    except HTTPException:
        raise
    except ValueError as e:
        logger.warning(f"Invalid storage_connections query: {str(e)}")
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        logger.error(f"Error querying storage_connectionss: {str(e)}", exc_info=True)
        raise HTTPException(status_code=500, detail=f"Internal server error: {str(e)}")


@router.get("/{id}", response_model=Storage_connectionsResponse)
async def get_storage_connections(
    id: int,
    fields: str = Query(None, description="Comma-separated list of fields to return"),
    current_user: UserResponse = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Get a single storage_connections by ID (user can only see their own records)"""
    logger.debug(f"Fetching storage_connections with id: {id}, fields={fields}")
    
    service = Storage_connectionsService(db)
    try:
        result = await service.get_by_id(id, user_id=str(current_user.id))
        if not result:
            logger.warning(f"Storage_connections with id {id} not found")
            raise HTTPException(status_code=404, detail="Storage_connections not found")
        
        return result
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error fetching storage_connections {id}: {str(e)}", exc_info=True)
        raise HTTPException(status_code=500, detail=f"Internal server error: {str(e)}")


@router.post("", response_model=Storage_connectionsResponse, status_code=201)
async def create_storage_connections(
    data: Storage_connectionsData,
    current_user: UserResponse = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Create a new storage_connections"""
    logger.debug(f"Creating new storage_connections with data: {data}")
    
    service = Storage_connectionsService(db)
    try:
        result = await service.create(data.model_dump(), user_id=str(current_user.id))
        if not result:
            raise HTTPException(status_code=400, detail="Failed to create storage_connections")
        
        logger.info(f"Storage_connections created successfully with id: {result.id}")
        return result
    except ValueError as e:
        logger.error(f"Validation error creating storage_connections: {str(e)}")
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        logger.error(f"Error creating storage_connections: {str(e)}", exc_info=True)
        raise HTTPException(status_code=500, detail=f"Internal server error: {str(e)}")


@router.post("/batch", response_model=List[Storage_connectionsResponse], status_code=201)
async def create_storage_connectionss_batch(
    request: Storage_connectionsBatchCreateRequest,
    current_user: UserResponse = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Create multiple storage_connectionss in a single request"""
    logger.debug(f"Batch creating {len(request.items)} storage_connectionss")
    
    service = Storage_connectionsService(db)
    results = []
    
    try:
        for item_data in request.items:
            result = await service.create(item_data.model_dump(), user_id=str(current_user.id))
            if result:
                results.append(result)
        
        logger.info(f"Batch created {len(results)} storage_connectionss successfully")
        return results
    except Exception as e:
        await db.rollback()
        logger.error(f"Error in batch create: {str(e)}", exc_info=True)
        raise HTTPException(status_code=500, detail=f"Batch create failed: {str(e)}")


@router.put("/batch", response_model=List[Storage_connectionsResponse])
async def update_storage_connectionss_batch(
    request: Storage_connectionsBatchUpdateRequest,
    current_user: UserResponse = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Update multiple storage_connectionss in a single request (requires ownership)"""
    logger.debug(f"Batch updating {len(request.items)} storage_connectionss")
    
    service = Storage_connectionsService(db)
    results = []
    
    try:
        for item in request.items:
            # Only include non-None values for partial updates
            update_dict = {k: v for k, v in item.updates.model_dump().items() if v is not None}
            result = await service.update(item.id, update_dict, user_id=str(current_user.id))
            if result:
                results.append(result)
        
        logger.info(f"Batch updated {len(results)} storage_connectionss successfully")
        return results
    except Exception as e:
        await db.rollback()
        logger.error(f"Error in batch update: {str(e)}", exc_info=True)
        raise HTTPException(status_code=500, detail=f"Batch update failed: {str(e)}")


@router.put("/{id}", response_model=Storage_connectionsResponse)
async def update_storage_connections(
    id: int,
    data: Storage_connectionsUpdateData,
    current_user: UserResponse = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Update an existing storage_connections (requires ownership)"""
    logger.debug(f"Updating storage_connections {id} with data: {data}")

    service = Storage_connectionsService(db)
    try:
        # Only include non-None values for partial updates
        update_dict = {k: v for k, v in data.model_dump().items() if v is not None}
        result = await service.update(id, update_dict, user_id=str(current_user.id))
        if not result:
            logger.warning(f"Storage_connections with id {id} not found for update")
            raise HTTPException(status_code=404, detail="Storage_connections not found")
        
        logger.info(f"Storage_connections {id} updated successfully")
        return result
    except HTTPException:
        raise
    except ValueError as e:
        logger.error(f"Validation error updating storage_connections {id}: {str(e)}")
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        logger.error(f"Error updating storage_connections {id}: {str(e)}", exc_info=True)
        raise HTTPException(status_code=500, detail=f"Internal server error: {str(e)}")


@router.delete("/batch")
async def delete_storage_connectionss_batch(
    request: Storage_connectionsBatchDeleteRequest,
    current_user: UserResponse = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Delete multiple storage_connectionss by their IDs (requires ownership)"""
    logger.debug(f"Batch deleting {len(request.ids)} storage_connectionss")
    
    service = Storage_connectionsService(db)
    deleted_count = 0
    
    try:
        for item_id in request.ids:
            success = await service.delete(item_id, user_id=str(current_user.id))
            if success:
                deleted_count += 1
        
        logger.info(f"Batch deleted {deleted_count} storage_connectionss successfully")
        return {"message": f"Successfully deleted {deleted_count} storage_connectionss", "deleted_count": deleted_count}
    except Exception as e:
        await db.rollback()
        logger.error(f"Error in batch delete: {str(e)}", exc_info=True)
        raise HTTPException(status_code=500, detail=f"Batch delete failed: {str(e)}")


@router.delete("/{id}")
async def delete_storage_connections(
    id: int,
    current_user: UserResponse = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Delete a single storage_connections by ID (requires ownership)"""
    logger.debug(f"Deleting storage_connections with id: {id}")
    
    service = Storage_connectionsService(db)
    try:
        success = await service.delete(id, user_id=str(current_user.id))
        if not success:
            logger.warning(f"Storage_connections with id {id} not found for deletion")
            raise HTTPException(status_code=404, detail="Storage_connections not found")
        
        logger.info(f"Storage_connections {id} deleted successfully")
        return {"message": "Storage_connections deleted successfully", "id": id}
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error deleting storage_connections {id}: {str(e)}", exc_info=True)
        raise HTTPException(status_code=500, detail=f"Internal server error: {str(e)}")